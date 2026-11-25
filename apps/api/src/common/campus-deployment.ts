const fallback = 'campus.example.invalid'
const candidate = process.env.CAMPUS_OFFICIAL_DOMAIN?.trim().toLowerCase()
const validDomain = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/
export const campusOfficialDomain = candidate && validDomain.test(candidate) ? candidate : fallback

export function isCampusOfficialHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === campusOfficialDomain || host.endsWith('.' + campusOfficialDomain)
}

// An opt-in, private IPv4 /16 network for hosts under the configured official domain.
export function isConfiguredCampusNetwork(address: string) {
  const value = process.env.CAMPUS_FETCH_IPV4_PREFIX?.trim()
  if (!value || !/^\d{1,3}\.\d{1,3}$/.test(value)) return false
  const [a,b] = value.split('.').map(Number)
  const privateNetwork = (a === 10 && b <= 255) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  return privateNetwork && address.startsWith(String(a) + '.' + b + '.')
}
