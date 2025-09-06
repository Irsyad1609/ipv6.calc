"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface CalculationResult {
  compressedAddress: string
  uncompressedAddress: string
  networkAddress: string
  startHost: string
  endHost: string
  totalAddresses: string
  subnetBreakdown: Array<{
    prefix: number
    count: string
    description: string
  }>
}

interface SubnetEnumerationResult {
  targetPrefix: number
  totalSubnets: string
  subnets: Array<{
    id: number
    subnetAddress: string
    hostRangeStart: string
    hostRangeEnd: string
    notation: string
  }>
}

export default function IPv6SubnetCalculator() {
  // Fungsi untuk mengunduh tabel sebagai CSV
  const downloadCSV = () => {
    if (!subnetEnumeration || !subnetEnumeration.subnets || subnetEnumeration.subnets.length === 0) {
      alert("No data to download.");
      return;
    }
    const headers = ["Subnet ID", "Subnet Address", "Host Address Range", "Notation"];
    const rows = subnetEnumeration.subnets.map((subnet: any) => [
      subnet.id,
      subnet.subnetAddress,
      `${subnet.hostRangeStart} - ${subnet.hostRangeEnd}`,
      subnet.notation
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row: any[]) => row.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    ].join("\r\n");
    try {
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `ipv6_subnets_page${currentPage}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Failed to download CSV. Please try again.");
    }
  };
  const [ipv6Address, setIpv6Address] = useState("")
  const [prefixLength, setPrefixLength] = useState("")
  const [result, setResult] = useState<CalculationResult | null>(null)
  const [error, setError] = useState("")

  const [targetSubnetPrefix, setTargetSubnetPrefix] = useState("")
  const [subnetEnumeration, setSubnetEnumeration] = useState<SubnetEnumerationResult | null>(null)
  const [showSubnetList, setShowSubnetList] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [subnetsPerPage] = useState(1000)
  const [searchNotation, setSearchNotation] = useState("")
  const [searchResult, setSearchResult] = useState<any>(null)
  const splitTableRef = useRef<HTMLDivElement | null>(null)

  const isValidIPv6 = (address: string): boolean => {
    const ipv6Regex = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/
    const doubleColonRegex = /::/

    if (!ipv6Regex.test(address) && !doubleColonRegex.test(address)) {
      return false
    }

    if (doubleColonRegex.test(address)) {
      const parts = address.split("::")
      if (parts.length > 2) return false

      const leftParts = parts[0] ? parts[0].split(":").filter((p) => p !== "") : []
      const rightParts = parts[1] ? parts[1].split(":").filter((p) => p !== "") : []

      if (leftParts.length + rightParts.length > 8) return false
    }

    return true
  }

  const expandIPv6 = (address: string): string => {
    let expanded = address.toLowerCase()

    if (expanded.includes("::")) {
      const parts = expanded.split("::")
      const leftParts = parts[0] ? parts[0].split(":").filter((p) => p !== "") : []
      const rightParts = parts[1] ? parts[1].split(":").filter((p) => p !== "") : []

      const missingParts = 8 - leftParts.length - rightParts.length
      const middleParts = Array(missingParts).fill("0000")

      expanded = [...leftParts, ...middleParts, ...rightParts].join(":")
    }

    const parts = expanded.split(":")
    return parts.map((part) => part.padStart(4, "0")).join(":")
  }

  const ipv6ToBigInt = (address: string): bigint => {
    const expanded = expandIPv6(address)
    const hex = expanded.replace(/:/g, "")
    return BigInt("0x" + hex)
  }

  const bigIntToIPv6 = (num: bigint): { compressed: string; uncompressed: string } => {
    const hex = num.toString(16).padStart(32, "0")
    const uncompressed = hex.match(/.{4}/g)!.join(":")

    let compressed = uncompressed
    const zeroGroups = compressed.match(/(^|:)(0000:)+/g)
    if (zeroGroups) {
      const longest = zeroGroups.reduce((a, b) => (a.length > b.length ? a : b))
      compressed = compressed.replace(longest, longest.startsWith(":") ? "::" : "::")
    }

    compressed = compressed.replace(/(^|:)0+([0-9a-f])/g, "$1$2")

    return { compressed, uncompressed }
  }

  const calculateSubnetBreakdown = (currentPrefix: number) => {
    const commonPrefixes = [48, 56, 60, 64, 72, 80, 96, 112, 120, 128]
    const breakdown = []

    for (const targetPrefix of commonPrefixes) {
      if (targetPrefix > currentPrefix) {
        const subnetCount = BigInt(1) << BigInt(targetPrefix - currentPrefix)
        const description = getSubnetDescription(targetPrefix)
        breakdown.push({
          prefix: targetPrefix,
          count: subnetCount.toString(),
          description,
        })
      }
    }

    return breakdown
  }

  const getSubnetDescription = (prefix: number): string => {
    switch (prefix) {
      case 48:
        return "Site prefix (ISP allocation to customer)"
      case 56:
        return "Customer site (recommended for home users)"
      case 60:
        return "Customer site (alternative for home users)"
      case 64:
        return "Subnet (standard network segment - RFC recommended)"
      case 72:
        return "Point-to-point links"
      case 80:
        return "Small subnets"
      case 96:
        return "IPv4-embedded IPv6 addresses"
      case 112:
        return "Very small subnets"
      case 120:
        return "Host subnets (8 hosts)"
      case 128:
        return "Single host address"
      default:
        return "Custom subnet size"
    }
  }

  const calculateSubnet = () => {
    setError("")
    setResult(null)

    if (!ipv6Address.trim()) {
      setError("Please enter an IPv6 address")
      return
    }

    if (!prefixLength.trim()) {
      setError("Please enter a prefix length")
      return
    }

    const prefix = Number.parseInt(prefixLength)
    if (isNaN(prefix) || prefix < 1 || prefix > 128) {
      setError("Prefix length must be between 1 and 128")
      return
    }

    if (!isValidIPv6(ipv6Address)) {
      setError("Invalid IPv6 address format")
      return
    }

    try {
      const addressBigInt = ipv6ToBigInt(ipv6Address)

      const subnetMask = (BigInt(1) << BigInt(128 - prefix)) - BigInt(1)
      const networkMask = ~subnetMask

      const networkAddress = addressBigInt & networkMask

      const startHost = networkAddress
      const endHost = networkAddress | subnetMask

      const totalAddresses = BigInt(1) << BigInt(128 - prefix)

      const inputFormatted = bigIntToIPv6(addressBigInt)
      const networkFormatted = bigIntToIPv6(networkAddress)
      const startFormatted = bigIntToIPv6(startHost)
      const endFormatted = bigIntToIPv6(endHost)

      const subnetBreakdown = calculateSubnetBreakdown(prefix)

      setResult({
        compressedAddress: inputFormatted.compressed,
        uncompressedAddress: inputFormatted.uncompressed,
        networkAddress: networkFormatted.compressed,
        startHost: startFormatted.compressed,
        endHost: endFormatted.compressed,
        totalAddresses: totalAddresses.toString(),
        subnetBreakdown,
      })
    } catch (err) {
      setError("Error calculating subnet. Please check your input.")
    }
  }

  const enumerateSubnets = (page = 1, scroll = false) => {
    if (!result || !targetSubnetPrefix) {
      setError("Please calculate the main subnet first and select a target prefix")
      return
    }

    const currentPrefix = Number.parseInt(prefixLength)
    const targetPrefix = Number.parseInt(targetSubnetPrefix)

    if (targetPrefix <= currentPrefix) {
      setError("Target prefix must be larger than current prefix")
      return
    }

    if (targetPrefix > 128) {
      setError("Target prefix cannot exceed /128")
      return
    }

  try {
      const networkAddress = ipv6ToBigInt(result.networkAddress)
      const subnetBits = targetPrefix - currentPrefix
      const totalSubnets = BigInt(1) << BigInt(subnetBits)
      const subnetSize = BigInt(1) << BigInt(128 - targetPrefix)

      const startIndex = (page - 1) * subnetsPerPage
      const endIndex = Math.min(startIndex + subnetsPerPage, Number(totalSubnets))
      const subnets = []

      for (let i = startIndex; i < endIndex; i++) {
        const subnetStart = networkAddress + BigInt(i) * subnetSize
        const subnetEnd = subnetStart + subnetSize - BigInt(1)

        const subnetFormatted = bigIntToIPv6(subnetStart)
        const endFormatted = bigIntToIPv6(subnetEnd)

        // Hilangkan ::0 di akhir notation
        let notationAddress = subnetFormatted.compressed.replace(/::0$/, '::')
        subnets.push({
          id: i + 1,
          subnetAddress: subnetFormatted.compressed,
          hostRangeStart: subnetFormatted.compressed,
          hostRangeEnd: endFormatted.compressed,
          notation: `${notationAddress}/${targetPrefix}`,
        })
      }

      setSubnetEnumeration({
        targetPrefix,
        totalSubnets: totalSubnets.toString(),
        subnets,
      })
      setCurrentPage(page)
      setShowSubnetList(true)
      setError("")
      if (scroll && splitTableRef.current) {
        setTimeout(() => {
          splitTableRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    } catch (err) {
      setError("Error enumerating subnets. Please check your input.")
    }
  }

  const getTotalPages = (): number => {
    if (!subnetEnumeration) return 0
    return Math.ceil(Number(subnetEnumeration.totalSubnets) / subnetsPerPage)
  }

  const handlePageChange = (page: number) => {
    enumerateSubnets(page)
  }

  const generatePrefixOptions = () => {
    if (!prefixLength) return []
    const currentPrefix = Number.parseInt(prefixLength)
    const options = []
    for (let i = currentPrefix + 1; i <= 128; i++) {
      options.push(i)
    }
    return options
  }

  const searchForNotation = () => {
    if (!subnetEnumeration || !searchNotation.trim()) {
      setError("Please enter a notation to search for")
      return
    }

    try {
      const currentPrefix = Number.parseInt(prefixLength)
      const targetPrefix = Number.parseInt(targetSubnetPrefix)
      const networkAddress = ipv6ToBigInt(result!.networkAddress)
      const subnetSize = BigInt(1) << BigInt(128 - targetPrefix)

      const searchParts = searchNotation.split("/")
      if (searchParts.length !== 2) {
        setError("Invalid notation format. Use format: address/prefix")
        return
      }

      const searchAddress = searchParts[0]
      const searchPrefix = Number.parseInt(searchParts[1])

      if (searchPrefix !== targetPrefix) {
        setError(`Search notation must use /${targetPrefix} prefix`)
        return
      }

      if (!isValidIPv6(searchAddress)) {
        setError("Invalid IPv6 address in search notation")
        return
      }

      const searchAddressBigInt = ipv6ToBigInt(searchAddress)

      const subnetIndex = (searchAddressBigInt - networkAddress) / subnetSize

      if (subnetIndex < 0 || subnetIndex >= BigInt(subnetEnumeration.totalSubnets)) {
        setError("Notation not found in current subnet range")
        return
      }

      const subnetStart = networkAddress + subnetIndex * subnetSize
      const subnetEnd = subnetStart + subnetSize - BigInt(1)
      const subnetFormatted = bigIntToIPv6(subnetStart)
      const endFormatted = bigIntToIPv6(subnetEnd)

      
      let notationAddress = subnetFormatted.compressed.replace(/::0$/, '::')
      setSearchResult({
        found: true,
        subnetId: Number(subnetIndex) + 1,
        subnetAddress: subnetFormatted.compressed,
        hostRangeStart: subnetFormatted.compressed,
        hostRangeEnd: endFormatted.compressed,
        notation: `${notationAddress}/${targetPrefix}`,
      })

      const pageNumber = Math.ceil(Number(subnetIndex + BigInt(1)) / subnetsPerPage)
      if (pageNumber !== currentPage) {
        handlePageChange(pageNumber)
      }

      setError("")
    } catch (err) {
      setError("Error searching for notation. Please check your input.")
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex items-center justify-center flex-col">
      <p className="text-sm text-muted-foreground max-w-4xl mx-auto mb-6 text-center">
        Calculate IPv6 network addresses, host ranges, Split subnets (Split large CIDR to small CIDR), and check notations within a given block.
      </p>
      <Card className="w-full max-w-6xl">
        <CardHeader>
          <div className="text-center space-y-2">
            <CardTitle className="text-2xl font-bold">IPv6 Subnet Calculator</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="ipv6-address">IPv6 Address</Label>
              <Input
                id="ipv6-address"
                type="text"
                placeholder="e.g., 2a0f:85c1:d36:1::"
                value={ipv6Address}
                onChange={(e) => setIpv6Address(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="prefix-length">Prefix /</Label>
              <Input
                id="prefix-length"
                type="number"
                min="1"
                max="128"
                placeholder="64"
                value={prefixLength}
                onChange={(e) => setPrefixLength(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={calculateSubnet} className="w-full md:w-auto">
            Calculate
          </Button>

          {result && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Subnet Splitter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <Label htmlFor="network-block">Network Address Block</Label>
                  <Input
                    id="network-block"
                    value={`${result.networkAddress}/${prefixLength}`}
                    readOnly
                    className="font-mono bg-gray-50"
                  />
                </div>
                <div>
                  <Label htmlFor="target-prefix">Target Subnet Size</Label>
                  <Select value={targetSubnetPrefix} onValueChange={setTargetSubnetPrefix}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select target prefix" />
                    </SelectTrigger>
                    <SelectContent>
                      {generatePrefixOptions().map((prefix) => {
                        const subnetCount = BigInt(1) << BigInt(prefix - Number.parseInt(prefixLength))
                        return (
                          <SelectItem key={prefix} value={prefix.toString()}>
                            /{prefix} ({subnetCount.toString()} subnets)
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={() => enumerateSubnets(1, true)} className="w-full md:w-auto">
                Split Subnets
              </Button>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">Calculation Results</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <dt className="font-medium text-muted-foreground">Compressed Address:</dt>
                  <dd className="font-mono text-sm break-all">{result.compressedAddress}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Uncompressed Address:</dt>
                  <dd className="font-mono text-sm break-all">{result.uncompressedAddress}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Network Address:</dt>
                  <dd className="font-mono text-sm break-all">{result.networkAddress}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Start Host Address:</dt>
                  <dd className="font-mono text-sm break-all">{result.startHost}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">End Host Address:</dt>
                  <dd className="font-mono text-sm break-all">{result.endHost}</dd>
                </div>
                <div>
                  <dt className="font-medium text-muted-foreground">Total Addresses:</dt>
                  <dd className="font-mono text-sm break-all">{result.totalAddresses}</dd>
                </div>
              </dl>
            </div>
          )}

          {subnetEnumeration && showSubnetList && (
            <div className="space-y-4" ref={splitTableRef}>
              <div className="flex justify-between items-center">
                <h4 className="text-lg font-semibold">Subnet Details (/{subnetEnumeration.targetPrefix})</h4>
                <div className="text-sm text-muted-foreground">
                  Total: {subnetEnumeration.totalSubnets} subnets
                  {getTotalPages() > 1 && (
                    <span>
                      {" "}
                      | Page {currentPage} of {getTotalPages()}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label htmlFor="search-notation">Search Notation</Label>
                  <Input
                    id="search-notation"
                    type="text"
                    placeholder={`e.g., 2a0f:85c1:d36:1::/${subnetEnumeration.targetPrefix}`}
                    value={searchNotation}
                    onChange={(e) => setSearchNotation(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <Button onClick={searchForNotation} variant="outline">
                  Search
                </Button>
              </div>

              {searchResult && (
                <Alert>
                  <AlertDescription>
                    <strong>Found:</strong> Subnet ID {searchResult.subnetId} - {searchResult.notation}
                    <br />
                    <span className="font-mono text-sm">
                      Range: {searchResult.hostRangeStart} - {searchResult.hostRangeEnd}
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              {getTotalPages() > 1 && (
                <div className="flex flex-wrap justify-center items-center gap-2 mb-4">
                  <Button variant="outline" size="sm" className="w-full sm:w-auto mb-2 sm:mb-0" onClick={() => handlePageChange(1)} disabled={currentPage === 1}>
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto mb-2 sm:mb-0"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="px-4 py-2 text-sm w-full sm:w-auto text-center">
                    Page {currentPage} of {getTotalPages()}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto mb-2 sm:mb-0"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === getTotalPages()}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto mb-2 sm:mb-0"
                    onClick={() => handlePageChange(getTotalPages())}
                    disabled={currentPage === getTotalPages()}
                  >
                    Last
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={downloadCSV}
                  >
                    Download CSV
                  </Button>
                </div>
              )}

              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="border border-gray-300 px-4 py-2 text-left">Subnet ID</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Subnet Address</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Host Address Range</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">Notation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subnetEnumeration.subnets.map((subnet) => (
                      <tr key={subnet.id} className="hover:bg-gray-50">
                        <td className="border border-gray-300 px-4 py-2">{subnet.id}</td>
                        <td className="border border-gray-300 px-4 py-2 font-mono text-sm">{subnet.subnetAddress}</td>
                        <td className="border border-gray-300 px-4 py-2 font-mono text-sm">
                          {subnet.hostRangeStart} - {subnet.hostRangeEnd}
                        </td>
                        <td className="border border-gray-300 px-4 py-2 font-mono text-sm">{subnet.notation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        {result && result.subnetBreakdown.length > 0 && (
          <div className="space-y-4 mt-8">
            <h4 className="text-lg font-semibold">Subnet Breakdown</h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-300 px-4 py-2 text-left">Prefix Length</th>
                    <th className="border border-gray-300 px-4 py-2 text-left">Number of Subnets</th>
                    <th className="border border-gray-300 px-4 py-2 text-left">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {result.subnetBreakdown.map((item) => (
                    <tr key={item.prefix} className="hover:bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2 font-mono">/{item.prefix}</td>
                      <td className="border border-gray-300 px-4 py-2 font-mono">{item.count}</td>
                      <td className="border border-gray-300 px-4 py-2 text-sm">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground max-w-4xl mx-auto mt-4 text-center">
        Designed by Irsyad Khoirul Anwar (
        <a
          href="https://www.as205018.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-blue-600 transition-colors"
        >
          AS205018
        </a>
        )
      </p>
    </div>
  )
}
