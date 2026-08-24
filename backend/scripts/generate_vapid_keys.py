"""One-time VAPID keypair generator for Web Push notifications (see
services/push_service.py). Run from backend/ with:

    ..\\venv\\Scripts\\python.exe -m scripts.generate_vapid_keys

Then copy the printed values: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY into
backend/.env, and VAPID_PUBLIC_KEY alone into frontend/.env.local as
VITE_VAPID_PUBLIC_KEY (the private key must never reach the frontend). Until those
env vars are set, push notifications stay a documented no-op — same soft-dependency
pattern as SMTP/Sentry/Redis in config.py.
"""

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid01
from py_vapid.utils import b64urlencode, num_to_bytes


def main() -> None:
    vapid = Vapid01()
    vapid.generate_keys()

    public_bytes = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    private_value = vapid.private_key.private_numbers().private_value
    private_bytes = num_to_bytes(private_value, 32)

    print("VAPID_PUBLIC_KEY=" + b64urlencode(public_bytes))
    print("VAPID_PRIVATE_KEY=" + b64urlencode(private_bytes))


if __name__ == "__main__":
    main()
