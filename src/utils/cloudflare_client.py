"""
Cloudflare API Client for Firebase Manager
Handles domain verification and DNS record management
"""
import os
import requests
import logging
import time
import hashlib
from typing import Dict, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)

class CloudflareClient:
    """Client for interacting with Cloudflare API"""
    
    def __init__(self, api_token: Optional[str] = None):
        """Initialize Cloudflare client with API token"""
        self.api_token = api_token or os.getenv('CLOUDFLARE_API_TOKEN')
        if not self.api_token:
            raise ValueError("CLOUDFLARE_API_TOKEN environment variable is required")
        
        self.base_url = "https://api.cloudflare.com/client/v4"
        self.headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
    
    def _make_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        """Make HTTP request to Cloudflare API"""
        url = f"{self.base_url}/{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=self.headers)
            elif method.upper() == "POST":
                response = requests.post(url, headers=self.headers, json=data)
            elif method.upper() == "PUT":
                response = requests.put(url, headers=self.headers, json=data)
            elif method.upper() == "DELETE":
                response = requests.delete(url, headers=self.headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            result = response.json()
            
            if not result.get('success', False):
                errors = result.get('errors', [])
                error_msg = ', '.join([e.get('message', 'Unknown error') for e in errors])
                raise Exception(f"Cloudflare API error: {error_msg}")
            
            return result
        
        except requests.exceptions.RequestException as e:
            logger.error(f"Cloudflare API request failed: {str(e)}")
            raise Exception(f"Failed to communicate with Cloudflare: {str(e)}")
    
    def get_zone_id(self, domain: str) -> Optional[str]:
        """Get zone ID for a domain"""
        # Extract root domain from subdomain (e.g., app.example.com -> example.com)
        parts = domain.split('.')
        if len(parts) >= 2:
            root_domain = '.'.join(parts[-2:])
        else:
            root_domain = domain
        
        try:
            result = self._make_request("GET", f"zones?name={root_domain}")
            zones = result.get('result', [])
            
            if zones:
                return zones[0]['id']
            
            logger.warning(f"No zone found for domain: {root_domain}")
            return None
        
        except Exception as e:
            logger.error(f"Failed to get zone ID for {domain}: {str(e)}")
            return None
    
    def list_dns_records(self, zone_id: str, record_type: Optional[str] = None, 
                        name: Optional[str] = None) -> List[Dict]:
        """List DNS records for a zone"""
        endpoint = f"zones/{zone_id}/dns_records"
        params = []
        
        if record_type:
            params.append(f"type={record_type}")
        if name:
            params.append(f"name={name}")
        
        if params:
            endpoint += "?" + "&".join(params)
        
        try:
            result = self._make_request("GET", endpoint)
            return result.get('result', [])
        except Exception as e:
            logger.error(f"Failed to list DNS records: {str(e)}")
            return []
    
    def add_dns_record(self, zone_id: str, record_type: str, name: str, 
                      content: str, ttl: int = 3600, priority: Optional[int] = None) -> Dict:
        """Add a DNS record to a zone"""
        data = {
            "type": record_type,
            "name": name,
            "content": content,
            "ttl": ttl,
            "proxied": False  # Don't proxy verification records
        }
        
        if priority is not None:
            data["priority"] = priority
        
        try:
            result = self._make_request("POST", f"zones/{zone_id}/dns_records", data)
            logger.info(f"Added {record_type} record: {name} -> {content}")
            return result.get('result', {})
        except Exception as e:
            logger.error(f"Failed to add DNS record: {str(e)}")
            raise
    
    def delete_dns_record(self, zone_id: str, record_id: str) -> bool:
        """Delete a DNS record"""
        try:
            self._make_request("DELETE", f"zones/{zone_id}/dns_records/{record_id}")
            logger.info(f"Deleted DNS record: {record_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete DNS record: {str(e)}")
            return False
    
    def verify_txt_record(self, domain: str, expected_value: str, max_attempts: int = 30) -> Tuple[bool, str]:
        """
        Verify that a TXT record exists with the expected value
        Polls DNS for up to max_attempts * 10 seconds
        """
        import dns.resolver
        
        for attempt in range(max_attempts):
            try:
                answers = dns.resolver.resolve(domain, 'TXT')
                for rdata in answers:
                    txt_value = rdata.to_text().strip('"')
                    if txt_value == expected_value:
                        logger.info(f"TXT record verified for {domain}")
                        return True, "Verification successful"
                
                # Record exists but value doesn't match
                if attempt == max_attempts - 1:
                    return False, f"TXT record found but value doesn't match. Expected: {expected_value}"
            
            except dns.resolver.NXDOMAIN:
                if attempt == max_attempts - 1:
                    return False, f"Domain {domain} does not exist"
            
            except dns.resolver.NoAnswer:
                if attempt == max_attempts - 1:
                    return False, f"No TXT record found for {domain}"
            
            except Exception as e:
                if attempt == max_attempts - 1:
                    return False, f"DNS query failed: {str(e)}"
            
            # Wait before next attempt
            time.sleep(10)
        
        return False, "Verification timeout - DNS propagation may take longer"
    
    def create_verification_record(self, domain: str) -> Tuple[str, str]:
        """
        Create a verification TXT record for a domain
        Returns: (record_name, verification_token)
        """
        # Generate verification token
        timestamp = datetime.now().isoformat()
        token_input = f"{domain}:{timestamp}:{os.urandom(16).hex()}"
        verification_token = hashlib.sha256(token_input.encode()).hexdigest()[:32]
        
        # Create verification subdomain
        verification_domain = f"_firebase-verify.{domain}"
        
        # Get zone ID
        zone_id = self.get_zone_id(domain)
        if not zone_id:
            raise Exception(f"Could not find Cloudflare zone for domain: {domain}")
        
        # Check if verification record already exists
        existing_records = self.list_dns_records(zone_id, "TXT", verification_domain)
        for record in existing_records:
            self.delete_dns_record(zone_id, record['id'])
        
        # Add new verification record
        self.add_dns_record(zone_id, "TXT", verification_domain, verification_token)
        
        logger.info(f"Created verification record for {domain}")
        return verification_domain, verification_token
    
    def setup_email_dns(self, domain: str, email_provider: str = "google") -> Dict[str, bool]:
        """
        Setup DNS records for email delivery
        Supports: google, sendgrid, mailgun
        """
        zone_id = self.get_zone_id(domain)
        if not zone_id:
            raise Exception(f"Could not find Cloudflare zone for domain: {domain}")
        
        results = {}
        
        # Email provider configurations
        if email_provider == "google":
            records = [
                ("MX", domain, "aspmx.l.google.com", 1),
                ("MX", domain, "alt1.aspmx.l.google.com", 5),
                ("MX", domain, "alt2.aspmx.l.google.com", 5),
                ("MX", domain, "alt3.aspmx.l.google.com", 10),
                ("MX", domain, "alt4.aspmx.l.google.com", 10),
                ("TXT", domain, "v=spf1 include:_spf.google.com ~all", None),
                ("TXT", f"_dmarc.{domain}", "v=DMARC1; p=none; rua=mailto:admin@{domain}", None),
            ]
        else:
            logger.warning(f"Unsupported email provider: {email_provider}")
            return results
        
        # Add each record
        for record_type, name, content, priority in records:
            try:
                # Check if record already exists
                existing = self.list_dns_records(zone_id, record_type, name)
                record_exists = any(r.get('content') == content for r in existing)
                
                if not record_exists:
                    if priority is not None:
                        self.add_dns_record(zone_id, record_type, name, content, priority=priority)
                    else:
                        self.add_dns_record(zone_id, record_type, name, content)
                    results[f"{record_type}:{name}"] = True
                else:
                    logger.info(f"Record already exists: {record_type} {name}")
                    results[f"{record_type}:{name}"] = True
            
            except Exception as e:
                logger.error(f"Failed to add {record_type} record for {name}: {str(e)}")
                results[f"{record_type}:{name}"] = False
        
        return results


# Singleton instance
_cloudflare_client: Optional[CloudflareClient] = None
_last_api_token: Optional[str] = None

def get_cloudflare_client() -> CloudflareClient:
    """Get or create Cloudflare client instance"""
    global _cloudflare_client, _last_api_token
    
    # Get current token from environment
    current_token = os.getenv('CLOUDFLARE_API_TOKEN')
    
    # Reset client if token has changed or doesn't exist yet
    if _cloudflare_client is None or current_token != _last_api_token:
        if current_token:
            _cloudflare_client = CloudflareClient(api_token=current_token)
            _last_api_token = current_token
            logger.info("Cloudflare client (re)initialized with updated token")
        else:
            _cloudflare_client = CloudflareClient()  # Will fail if no token in env
            _last_api_token = os.getenv('CLOUDFLARE_API_TOKEN')
    
    return _cloudflare_client
