# Att Errors

List of Attribute protocol errors.

```javascript
const NodeBleHost = require('ble-host');
const AttErrors = NodeBleHost.AttErrors;
```

## Integer constants

The defined constants below are properties of `AttErrors`.

Bluetooth SIG assigned constants:

```javascript
INVALID_HANDLE: 0x01
READ_NOT_PERMITTED: 0x02
WRITE_NOT_PERMITTED: 0x03
INVALID_PDU: 0x04
INSUFFICIENT_AUTHENTICATION: 0x05
REQUEST_NOT_SUPPORTED: 0x06
INVALID_OFFSET: 0x07
INSUFFICIENT_AUTHORIZATION: 0x08
PREPARE_QUEUE_FULL: 0x09
ATTRIBUTE_NOT_FOUND: 0x0a
ATTRIBUTE_NOT_LONG: 0x0b
INSUFFICIENT_ENCRYPTION_KEY_SIZE: 0x0c
INVALID_ATTRIBUTE_VALUE_LENGTH: 0x0d
UNLIKELY_ERROR: 0x0e
INSUFFICIENT_ENCRYPTION: 0x0f
UNSUPPORTED_GROUP_TYPE: 0x10
INSUFFICIENT_RESOURCES: 0x11

WRITE_REQUEST_REJECTED: 0xfc
CLIENT_CHARACTERISTIC_CONFIGURATION_DESCRIPTOR_IMPROPERLY_CONFIGURED: 0xfd
PROCEDURE_ALREADY_IN_PROGRESS: 0xfe
OUT_OF_RANGE: 0xff
```

Custom constants:

```javascript
SUCCESS: 0
RELIABLE_WRITE_RESPONSE_NOT_MATCHING: -1
```

The range `0x80` - `0x9F` is used for custom Application Errors.

## AttErrors.toString(code)
* `code` {integer} Error code

Returns the corresponding key (e.g. `OUT_OF_RANGE`) for a given code, `APPLICATION_ERROR_0x??` for an Application Error code, or `(unknown)` if not one of the above.
