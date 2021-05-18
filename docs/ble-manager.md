# BLE Manager

This is the high level class that is used to initiate scans, connect to devices etc. using a user-supplied transport object.

## Creating a BleManager object
```javascript
const NodeBleHost = require('ble-host');
const BleManager = NodeBleHost.BleManager;
var transport = ...;
var options = {
    staticRandomAddress: 'CC:CC:CC:CC:CC:CC'; // optional property
};
BleManager.create(transport, options, function(err, manager) {
    // err is either null or an Error object
    // if err is null, manager contains a fully initialized BleManager object
    ...
});
```

## The transport object
The transport object is the I/O object the BleManager uses to send and receive HCI packets. The only requirements are that it inherits from `EventEmitter`, has a `write` method (with a `Buffer` as argument which is used when one HCI packet is to be sent) and has a `data` event which shall be called with a `Buffer` as argument whenever a HCI packet is received. It may have a `close` event which should be emitted if the transport closes. The data format used is defined in Bluetooth Core specification v5, Volume 4 Part A - UART Transport Layer section 2. One single full packet per write/data event.

For Linux, the use of `node-hci-socket` is recommended which implements these requirements:

    const NodeHciSocket = require('hci-socket');
    var transport = new NodeHciSocket(0); // 0 is hci device id, as in hci0 as shown by hciconfig

## Class: BleManager

### manager.startScan(parameters)
* `parameters` {Object}
  * `activeScan` {boolean} Whether the scan response data should be requested (default: true)
  * `scanWindow` {number} Integer multiple of 0.625 ms for the suggested scan window (default: 16)
  * `scanInterval {number} Integer multiple of 0.625 ms for the suggested scan interval (default: 16)
  * `filterDuplicates` {boolean} Whether duplicates should be removed (default: false)
  * `scanFilters` {ScanFilter[]} Array of scan filters (default: accept all devices)
* Returns: {Scanner} The created and started scanner object

This method starts a scan. Either none or both of `scanWindow` and `scanInterval` must be present. Note that these are just suggested values. If there are multiple concurrent scanners and/or pending connections the real scan window and scan interval may be set to compromised values. The default values (16 and 16) will only be used if there are no other concurrent scans and/or pending connections with other suggested values.

Multiple scans can be started concurrently. (While the outer behaviour is that multiple scans are active at the same time, the library only really issues one scan internally.)

If `filterDuplicates` is active, there will be a cache with maximum size of 1024 devices. If this limit is reached old entries might not be filtered away the next time those devices advertise again.

The `scanFilters` parameter, if present, should contain an array of scan filters (see below). An advertisement will only be reported if it matches any of the filters in the array.

The returned scanner object can be used to stop the scan. Each advertisement will be reported by the `report` event to this object.

### manager.connect(bdAddrType, bdAddr, parameters, callback)
* bdAddrType {string} `public` or `random`
* bdAddr {string} Bluetooth Device Address of the device to connect to
* parameters {Object} All sub-items are optional
  * connIntervalMin {number} Integer in the range 6-3200 in units of 1.25 ms (default: 20)
  * connIntervalMax {number} Integer in the range 6-3200 in units of 1.25 ms (default: 25)
  * connLatency {number} Integer in the range 0-499 defining Slave Latency (default: 0)
  * supervisionTimeout {number} Integer in the range 10-3200 in units of 10 ms (default: 500)
  * minimumCELength {number} Integer in the range 0-65535 in units of 0.625 ms (default: 0)
  * maximumCELength {number} Integer in the range 0-65535 in units of 0.625 ms (default: 0)
* callback {Function} Callback called when the device connects
  * connection {Connection} The object used to interact with the remote device (GATT, SMP, L2CAPCoC etc.)
* Returns: {PendingConnection} Object that can be used to cancel the connection attempt

This method connects to the given device with the supplied parameters. All parameters are optional but there are a few rules.
* Either none or both of connIntervalMin and connIntervalMax must be supplied, and min <= max.
* Either none or both of minimumCELength and maximumCELength must be supplied, and min <= max.
* If connection interval and supervision timeout is supplied, `connIntervalMax*1.25 * (connLatency + 1) * 2 < supervisionTimeout*10` per Bluetooth specification. This is to make sure the link won't be dropped if one packet gets missed.

The minimumCELength/maximumCELength indicate the minimum and maximum Connection Event length. This defines how much radio time in each connection interval that can be used to send and receive packets. Setting CE length to be as long as the connection interval means that the devices will keep exchanging packets during the whole connection interval unless the event collides with another connection or scan. The default value is 0 which means it's up to the controller how many packets are sent in each connection event (this varies a lot between different manufacturers).

Regardless of how many pending connections there are, the HCI protocol only allows one set of parameters for a pending connection to be active. Therefore all parameters are just suggested ones and the real values depend on the other pending connections' parameters. The default values will only be used if no pending connection have a suggested value. Also note that the Supervision Timeout default value is automatically adjusted if the formula above requires it to be higher. Similarly, the default Slave Latency value is also automatically decreased if the formula above requires it.

When the connection completes, the callback will called with a `Connection` object as the only parameter.

### manager.gattDb

{GattServerDb}

See the GATT Server section

### manager.removeBond(identityAddressType, identityAddress)
* identityAddressType {string} The identity address type, `public` or `random`
* identityAddress {string} The identity address

This method can be used to remove a bond between the currently used Bluetooth controller address and a peer device. There must be no active connection to the indicated device, or an error will be thrown.

### manager.setAdvertisingData(data[, callback])
* data {Buffer} A buffer of max 31 bytes containing Advertising Data
* callback {Function} Callback

This method sets the advertising data in the controller and calls `callback` with the HCI status code as the result parameter.

### manager.setScanResponseData(data[, callback])
* data {Buffer} A buffer of max 31 bytes containing Scan Response Data
* callback {Function} Callback

This method sets the scan response data in the controller and calls `callback` with the HCI status code as the result parameter.

### manager.startAdvertising(parameters, callback)
* parameters {Object} All sub-items are optional
  * intervalMin {number} Advertising interval min, integer between 0x20 and 0x4000 in units of 0.625 ms (default: 62.5 ms)
  * intervalMax {number} Advertising interval max, integer between 0x20 and 0x4000 in units of 0.625 ms (default: 62.5 ms)
  * advertisingType {string} `ADV_IND`, `ADV_DIRECT_IND_HIGH_DUTY_CYCLE`, `ADV_SCAN_IND`, `ADV_NONCONN_IND` or `ADV_DIRECT_IND_LOW_DUTY_CYCLE` (default: `ADV_IND`)
  * directedAddress {Object} If a directed advertising type is selected, this parameter must be present
    * type {string} `public` or `random`
    * address {string}
  * channelMap {number[]} An array containing any combination of `37`, `38` and `39` (default: `[37, 38, 39]`)
* callback {Function} Callback

This method starts advertising with the given parameters.

If the advertising could not be started, the callback is called with an HCI error code as parameter.

When a master device connects, advertising is automatically stopped and the callback will be called with the following parameters:
* status {number} Will be 0
* conn {Connection} An object representing the connection

### manager.stopAdvertising([callback])
* callback {Function} Callback

Stops an ongoing advertising. The callback will be called with an HCI status code as parameter.

If the advertising is stopped and no master device connects, the callback of the `startAdvertising` method will not be called.

Note that since the Bluetooth controller runs on a separate chip, it is possible that a master device connects after this method has been called, but before the Bluetooth controller has received the command. In this case both the callback indicating advertising has stopped as well as the callback in the `startAdvertising` method may be called. The Bluetooth specification is not clear in which order these events might happen.

## Class: Scanner

### scanner.stopScan()
Stops the scan. No further reports will be emitted.

### Event: 'report'
* eventData {Object}
  * connectable {boolean} If the device is connectable (i.e. it did not send `ADV_NONCONN_IND`)
  * addressType {string} `public` or `random`
  * address {string}
  * rssi {number} Signed integer in dBm (-127 to 20), 127 means not available
  * rawDataItems {Object[]}
    * type {number}
    * data {Buffer}
  * parsedDataItems {Object} Object with the advertising data items; only included fields will be present
    * flags {Object}
      * leLimitedDiscoverableMode {boolean}
      * leGeneralDiscoverableMode {boolean}
      * brEdrNotSupported {boolean}
      * simultaneousLeAndBdEdrToSameDeviceCapableController {boolean}
      * simultaneousLeAndBrEdrToSameDeviceCapableHost {boolean}
      * raw {Buffer}
    * serviceUuids {string[]} Array of UUIDs
    * localName {string} If only the shortened form is present, the string will end with `...`
    * txPowerLevel {number} Signed integer in dBm
    * slaveConnectionIntervalRange {Object}
      * min {number} Integer
      * max {number} Integer
    * serviceSolicitations {string[]} Array of UUIDs
    * serviceData {Object[]}
      * uuid {string}
      * data {Buffer}
    * appearance {number} 16-bit integer
    * publicTargetAddresses {string[]}
    * randomTargetAddresses {string[]}
    * advertisingInterval {number}
    * uri {string}
    * leSupportedFeatures {Object}
      * low {number} The 32 lower bits as an unsigned integer
      * high {number} The 32 higher bits as an unsigned integer
    * manufacturerSpecificData {Object[]}
      * companyIdentifierCode {number}
      * data {Buffer}

## Class: PendingConnection

### pendingConnection.cancel(callback)
* callback {Function} Callback if the cancel succeeds

This method is called to cancel a pending connection. Since the connection might complete at the exact moment this method is called (and it takes some time for the event to be sent from the controller to the host), it is possible that the cancel does not succeed. In that case the normal connect callback (and the `connect` event) will be called and the cancel callback will never be called.

### Event: 'connect'
* connection {Connection}

Emitted when the device connects. The `callback` parameter to the `connect` method of BleManager is internally registered as an event handler to this event.

## Class: Connection

### connection.ownAddressType

{string}

Contains the address type of the local address for this connection (`public` or `random`).

### connection.ownAddress

{string}

Contains the local address for this connection.

### connection.peerAddressType

{string}

Contains the address type of the peer address for this connection (`public` or `random`).

### connection.peerAddress

{string}

Contains the peer address for this connection.

### connection.peerIdentityAddressType

{string} or {null}

Contains the address type of the identity address of the peer device. This will be equal to `connection.peerAddressType` if a public or static random address is used. Otherwise it will be `null` unless the address could be resolved using the an IRK in the bond storage. If the address could be resolved, this value will contain the address type of the identity address. The identity address, compared to a resolvable address, doesn't change and can hence be used as an identifier.

This value will also be changed after pairing has completed.

### connection.peerIdentityAddress

{string} or {null}

Contains the identity address of the peer device. This will be equal to `connection.peerAddress` if a public or static random address is used. Otherwise it will be `null` unless the address could be resolved using the an IRK in the bond storage. If the address could be resolved, this value will contain the identity address. The identity address, compared to a resolvable address, doesn't change and can hence be used as an identifier.

This value will also be changed after pairing has completed.

### connection.disconnected

{boolean}

When the BLE link has finally disconnected, this property is set to `true`. The `disconnect` event is then emitted.


### connection.smp

{SmpMasterConnection} or {SmpSlaveConnection}

See the Security Manager section.

### connection.gatt

{GattConnection}

See the GATT Client section.

### connection.l2capCoCManager

{L2CAPCoCManager}

See the L2CAP CoC section.

### connection.setTimeout(callback, milliseconds)
* callback {Function} A callback to invoke
* milliseconds {number} After how long time the callback will be invoked
* Returns: {Function} A function that when called cancels the timeout.

After `milliseconds` ms has passed, the `callback` will be invoked with no parameters. If the connection becomes disconnected before the specified time has passed, the timeout is automatically cancelled. This method can be used for setting up timers that are only relevant if the connection stays alive.

### connection.disconnect([reason][, startIgnoreIncomingData])
* reason {number} An error code indicating reason for disconnecting (default: HciErrors.REMOTE_USER_TERMINATED_CONNECTION)
* startIgnoreIncomingData {boolean} If no more incoming data should be processed until the connection actually disconnects (default: false)

This method will initiate the disconnection procedure. Since the Bluetooth controller will wait for an acknowledgement from the peer before the link actually disconnects (or a timeout), the link will stay active until that happens. The `startIgnoreIncomingData` parameter can be used to avoid incoming data to be processed during this procedure, if desired.

The `reason` can be any of:
* HciErrors.AUTHENTICATION_FAILURE
* HciErrors.REMOTE_DEVICE_TERMINATED_CONNECTION_DUE_TO_LOW_RESOURCES
* HciErrors.REMOTE_DEVICE_TERMINATED_CONNECTION_DUE_TO_POWER_OFF
* HciErrors.UNACCEPTABLE_CONNECTION_PARAMETERS
* HciErrors.REMOTE_USER_TERMINATED_CONNECTION (default)

When the link finally disconnects, the `disconnected` property will be set to true and the `disconnect` event will be emitted.

### connection.readRssi(callback)
* callback {Function} Callback

If the `disconnected` property is false, then an attempt to read the RSSI value is performed. The callback will then be called with the following parameters:
* status {number} An HCI error code indicating the status
* rssi {number} or {undefined} If status was 0, contains an indication of arriving signal strength at the antenna measured in dBm, where -127 means the signal strength indication is not available

### connection.updateConnParams(parameters[, callback])
* parameters {Object} See `manager.connect(bdAddrType, bdAddr, parameters, callback)`
* callback {Function} Callback

If the current role is master, a HCI command will be used to update the parameters. If the current role is slave, an L2CAP signalling packet is instead sent.

When the procedure completes, the `callback` will be called with the following parameters:
* status {number} For master role, contains the HCI status code of the result. For slave role, the following values are valid:
  * 0: The parameters were accepted
  * 1: The parameters were rejected
  * -1: No L2CAP response arrived from the peer within 30 seconds
  * -2: The request was never sent because new parameters were requested before this request could be sent

### Event: 'connectionUpdate'
* interval {number} Connection interval in units of 1.25 ms
* latency {number} Slave latency
* timeout {number} Supervision timeout in units of 0.625 ms

This event is emitted when the connection parameters have been updated.

### Event: 'updateConnParamsRequest'
* parameters {Object} See `manager.connect(bdAddrType, bdAddr, parameters, callback)`
* callback {Function} Callback

If the current role is master, this event will be called when a slave sends a connection parameter update request over L2CAP. If this event has no listeners, the parameters are automatically accepted and applied.

If this event is listened to, the callback must be called with a boolean parameter indicating if the parameters are accepted or not. The `connection.updateConnParams(parameters[, callback])` method must then be called to perform the update, normally passing in the same `parameters` object unless minor changes allowed by the standard are desired.

### Event: 'disconnect'
* reason {number} A HCI error code indicating the reason for disconnecting

This event indicates the link has finally been terminated. All objects having this connection as parent (or grandparent) are now considered dead, such as `gatt`, `smp`, `l2capCoCManager` and every GATT characteristic object etc. Any pending callback relating to those objects will not be called.
