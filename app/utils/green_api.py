"""
Green API's address for a WhatsApp instance — the one place every call builds it.

Green API serves each instance from its own host: https://{the instance id's first 4 digits}.api.greenapi.com (the
"apiUrl" shown for the instance in the Green API console). The old shared host, api.green-api.com, stopped answering
on 2026-10-10 in the evening — every WhatsApp then failed with state "unknown" while the phone itself was connected
("authorized" on the instance's own host).
"""
from __future__ import annotations

PARTNER_BASE = "https://api.greenapi.com"        # the partner methods (create / delete an instance)


def instance_base(instance_id) -> str:
    iid = str(instance_id).strip()
    return f"https://{iid[:4]}.api.greenapi.com"


def instance_url(instance_id, method: str, token: str) -> str:
    """https://{4 digits}.api.greenapi.com/waInstance{id}/{method}/{token}"""
    iid = str(instance_id).strip()
    return f"{instance_base(iid)}/waInstance{iid}/{method}/{token}"
