 
# AdvertisingDataBuilder

Utility class for constructing advertising packets into byte arrays.

## Class: AdvertisingDataBuilder

Example:

```javascript
const NodeBleHost = require('ble-host');
const AdvertisingDataBuilder = NodeBleHost.AdvertisingDataBuilder;

const advDataBuffer = new AdvertisingDataBuilder()
                          .addFlags(['leGeneralDiscoverableMode', 'brEdrNotSupported'])
                          .addLocalName(true, 'MyDevice')
                          .build();
```

An advertising packet can be at most 31 bytes long. If an item that is being added would not fit, an `Error` will be thrown.

All functions below, except `build()`, return `this` to allow chaining calls.

### advertisingDataBuilder.addFlags(flags)
* `flags` {string[]} Array of flags to include

Allowed flags:

* 'leLimitedDiscoverableMode'
* 'leGeneralDiscoverableMode'
* 'brEdrNotSupported'
* 'simultaneousLeAndBdEdrToSameDeviceCapableController'
* 'simultaneousLeAndBrEdrToSameDeviceCapableHost'

Generally 'leGeneralDiscoverableMode' and 'brEdrNotSupported' should be set.

### advertisingDataBuilder.add128BitServiceUUIDs(isComplete, uuids)
* `isComplete` {boolean} Whether the provided list of UUIDs include all 128-bit services that exist in the device's GATT database.
* `uuids` {string[]} An array of 128-bit UUIDs.

### advertisingDataBuilder.add16BitServiceUUIDs(isComplete, uuids)
* `isComplete` {boolean} Whether the provided list of UUIDs include all 16-bit services that exist in the device's GATT database.
* `uuids` {uuid[]} An array of 16-bit UUIDs. Each item can either be an integer, or a 128-bit UUID string using the base UUID.

### advertisingDataBuilder.addLocalName(isComplete, name)
* `isComplete` {boolean} Whether the provided name is complete or truncated.
* `name` {string} The name, or the truncated part of the name.

### advertisingDataBuilder.addManufacturerData(companyIdentifierCode, data)
* `companyIdentifierCode` {integer} A 16-bit Bluetooth SIG assigned company identifier.
* `data` {Buffer} Data.

### advertisingDataBuilder.addTxPowerLevel(txPowerLevel)
* `txPowerLevel` {integer} The power level for this the transmitted advertising packet. Shall be between -127 and 127 dBm.

### advertisingDataBuilder.addSlaveConnectionIntervalRange(connIntervalMin, connIntervalMax)
* `connIntervalMin` {integer} In units of 1.25 ms.
* `connIntervalMax` {integer} In units of 1.25 ms.

### advertisingDataBuilder.add16BitServiceSolicitation(uuids)
* `uuids` {uuid[]} An array of 16-bit UUIDs. Each item can either be an integer, or a 128-bit UUID string using the base UUID.

### advertisingDataBuilder.add128BitServiceSolicitation(uuids)
* `uuids` {string[]} An array of 128-bit UUIDs.

### advertisingDataBuilder.add16BitServiceData(uuid, data)
* `uuid` {uuid} An integer, or a 128-bit UUID string using the base UUID.
* `data` {Buffer} Service data.

### advertisingDataBuilder.add128BitServiceData(uuid, data)
* `uuid` {string} A 128-bit UUID.
* `data` {Buffer} Service data.

### advertisingDataBuilder.addAppearance(appearanceNumber)
* `appearanceNumber` {integer} A 16-bit number representing the appearance.

### advertisingDataBuilder.addPublicTargetAddresses(addresses)
* `addresses` {string[]} An array of Public Bluetooth device addresses this advertisement targets.

### advertisingDataBuilder.addRandomTargetAddresses(addresses)
* `addresses` {string[]} An array of Random Bluetooth device addresses this advertisement targets.

### advertisingDataBuilder.addAdvertisingInterval(interval)
* `interval` {integer} In units of 0.625 ms.

### advertisingDataBuilder.addUri(uri)
* `uri` {string} An URI. See the specification for the required format.

### advertisingDataBuilder.addLeSupportedFeatures(low, high)
* `low` {integer} A 32-bit integer representing the least significant 32 bits.
* `high` {integer} A 32-bit integer representing the most significant 32 bits.

### advertisingDataBuilder.build()

Returns: A {Buffer} that contains a concatenation of all added items.
