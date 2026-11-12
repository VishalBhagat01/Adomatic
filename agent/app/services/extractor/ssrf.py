"""
AdPilot AI - Server-Side Request Forgery (SSRF) Protection and URL Validator
Guards against malicious internal network access, cloud metadata endpoints, loopback,
private CIDRs, and non-standard ports.
"""

import ipaddress
import socket
import urllib.parse
from typing import List, Optional, Tuple

# Blocked IPv4 networks
BLOCKED_IPV4_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),          # Current network
    ipaddress.ip_network("10.0.0.0/8"),         # RFC 1918 private
    ipaddress.ip_network("100.64.0.0/10"),      # Shared address / CGNAT
    ipaddress.ip_network("127.0.0.0/8"),        # Loopback
    ipaddress.ip_network("169.254.0.0/16"),     # Link-local / Cloud metadata (169.254.169.254)
    ipaddress.ip_network("172.16.0.0/12"),      # RFC 1918 private
    ipaddress.ip_network("192.0.0.0/24"),       # IETF protocol assignments
    ipaddress.ip_network("192.0.2.0/24"),       # TEST-NET-1
    ipaddress.ip_network("192.168.0.0/16"),     # RFC 1918 private
    ipaddress.ip_network("198.18.0.0/15"),      # Benchmark testing
    ipaddress.ip_network("198.51.100.0/24"),    # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),     # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("240.0.0.0/4"),        # Reserved
    ipaddress.ip_network("255.255.255.255/32"), # Broadcast
]

# Blocked IPv6 networks
BLOCKED_IPV6_NETWORKS = [
    ipaddress.ip_network("::1/128"),            # Loopback
    ipaddress.ip_network("::/128"),             # Unspecified
    ipaddress.ip_network("::ffff:0:0/96"),      # IPv4-mapped
    ipaddress.ip_network("64:ff9b::/96"),       # IPv4/IPv6 translation
    ipaddress.ip_network("100::/64"),           # Discard prefix
    ipaddress.ip_network("2001:db8::/32"),      # Documentation
    ipaddress.ip_network("fc00::/7"),           # Unique local address (ULA)
    ipaddress.ip_network("fe80::/10"),          # Link-local
    ipaddress.ip_network("ff00::/8"),           # Multicast
]

ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_PORTS = {80, 443}


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Check if an IP address belongs to any blocked or private subnet."""
    if isinstance(ip, ipaddress.IPv4Address):
        return any(ip in net for net in BLOCKED_IPV4_NETWORKS)
    elif isinstance(ip, ipaddress.IPv6Address):
        # Also check for IPv4-mapped addresses
        if ip.ipv4_mapped:
            return is_ip_blocked(ip.ipv4_mapped)
        return any(ip in net for net in BLOCKED_IPV6_NETWORKS)
    return True


def validate_safe_url(
    url_str: str,
    allowlist: Optional[List[str]] = None,
    resolve_dns: bool = True
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate that a URL is well-formed, uses http/https, connects only to standard ports,
    and resolves strictly to safe, public IP addresses.

    Returns:
        (is_safe, canonical_url, error_message)
    """
    if not url_str or not isinstance(url_str, str):
        return False, None, "URL must be a non-empty string"

    url_str = url_str.strip()

    try:
        parsed = urllib.parse.urlparse(url_str)
    except Exception as e:
        return False, None, f"Malformed URL syntax: {str(e)}"

    # 1. Scheme check
    if not parsed.scheme or parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, None, f"Unsupported URL scheme '{parsed.scheme}'. Only http and https are allowed."

    # 2. Host check
    hostname = parsed.hostname
    if not hostname:
        return False, None, "URL must contain a valid hostname."

    hostname_lower = hostname.lower()

    # Block obvious cloud metadata / localhost hostnames
    blocked_hosts = {
        "localhost",
        "metadata.google.internal",
        "instance-data",
        "169.254.169.254",
        "0.0.0.0",
        "127.0.0.1",
        "::1",
    }
    if hostname_lower in blocked_hosts or hostname_lower.endswith(".local") or hostname_lower.endswith(".internal"):
        return False, None, f"Access to host '{hostname}' is blocked for security reasons."

    # 3. Port check
    port = parsed.port
    if port is not None and port not in ALLOWED_PORTS:
        return False, None, f"Port {port} is not permitted. Only standard web ports (80, 443) are allowed."

    # 4. Optional domain allowlist
    if allowlist:
        domain_matched = any(
            hostname_lower == allowed.lower() or hostname_lower.endswith(f".{allowed.lower()}")
            for allowed in allowlist
        )
        if not domain_matched:
            return False, None, f"Domain '{hostname}' is not in the allowed domain list."

    # 5. Direct IP check & DNS Resolution check
    if resolve_dns:
        try:
            # Check if hostname itself is a raw IP literal
            try:
                ip_obj = ipaddress.ip_address(hostname)
                if is_ip_blocked(ip_obj):
                    return False, None, f"Direct connection to private/internal IP '{hostname}' is forbidden."
            except ValueError:
                # Hostname is a domain name, resolve via DNS
                addr_info = socket.getaddrinfo(hostname, port or (443 if parsed.scheme == "https" else 80))
                for entry in addr_info:
                    sockaddr = entry[4]
                    ip_str = sockaddr[0]
                    resolved_ip = ipaddress.ip_address(ip_str)
                    if is_ip_blocked(resolved_ip):
                        return False, None, f"Host '{hostname}' resolved to blocked/internal IP '{ip_str}'."
        except socket.gaierror as e:
            return False, None, f"Could not resolve domain '{hostname}': {str(e)}"
        except Exception as e:
            return False, None, f"DNS resolution error for '{hostname}': {str(e)}"

    canonical_url = urllib.parse.urlunparse(parsed)
    return True, canonical_url, None

