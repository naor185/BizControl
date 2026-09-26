"""
The one place the server knows BizFind's address — every link a message or an e-mail sends to BizFind
(a booking, the waitlist, verifying an e-mail) is built from BIZFIND_URL here, never a domain typed at the
call site. Set BIZFIND_URL on the server when BizFind moves to a new domain; until then it is
find.biz-control.com (the web app reads the same address from NEXT_PUBLIC_BIZFIND_URL, web/src/lib/config.ts).
"""
import os

BIZFIND_URL = (os.getenv("BIZFIND_URL") or "https://find.biz-control.com").rstrip("/")
