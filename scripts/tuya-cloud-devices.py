import tinytuya

# Use the Tuya IoT credentials to query cloud for devices
c = tinytuya.Cloud(
    apiRegion="us",
    apiKey="dn7p8wf3hxu7j9xmhcwv",
    apiSecret="9dd4afcb6d0544c788ff9a39a22cbd01",
)

# Get list of devices
devices = c.getdevices()
print(f"Found {len(devices)} devices:\n")
for d in devices:
    print(f"  Name: {d.get('name', 'unnamed')}")
    print(f"  ID: {d.get('id')}")
    print(f"  Key: {d.get('key')}")
    print(f"  Category: {d.get('category')}")
    print(f"  Product: {d.get('product_name')}")
    print(f"  IP: {d.get('ip')}")
    print(f"  Online: {d.get('online')}")
    print(f"  ---")
