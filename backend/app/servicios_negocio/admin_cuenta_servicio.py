"""Retired admin account-creation service.

Admin account creation is no longer a supported application capability. The
public enrollment flow owns supported account creation; this module is kept as
an empty compatibility path only so stale deployments fail at import time
rather than silently recreating admin accounts.
"""

__all__: tuple[str, ...] = ()
