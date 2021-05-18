# GATT Server

Each device must have a GATT Server with a GATT DB. By default only two GATT Services are present in the database; the Generic Access Service and the GATT Service. More services can be added.

### UUIDs
All UUID inputs are required to be either strings in the format `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`, or a 16-bit unsigned integer number (in which case it is assumed to be an UUID in Bluetooth SIG's base range).

### Values
All characteristic and descriptor values that this API outputs are always Buffer objects. All value inputs may be either Buffers or strings. If the value is a string, it is converted to a Buffer using the UTF-8 encoding. However, the `value` property of characteristics and descriptors is treated differently. See its documentation for more info.

### MTU
The MTU value is shared with the GATT Client instance. See its documentation for more information.

## Class: GattServerDb

This class is used to control the GATT DB. Each HCI Manager has an own instance of this class, which can be retrieved through its `gattDb` property.

### gattDb.setDeviceName(name)
* `name` {Buffer} or {string} The new device name to store in the Device Name characteristic (max 248 bytes)

Sets the Device Name characteristic.

### gattDb.setAppearance(appearance)
* `appearance` {number} 16-bit unsigned integer

Sets the Appearance characteristic.

### gettDb.getSvccCharacteristic()
* Returns: {GattServerCharacteristic} The Service Changed Characteristic

Returns the Service Changed Characteristic in the GATT service which is automatically created. Use this to send indications if the GATT DB is changed.

### gattDb.addServices(services)
* `services` {GattServerService[]} Array of services

Adds one or more services to the GATT DB.

### gattDb.removeService(service)
* `service` {GattServerService} A service to remove
* Returns: {boolean} Whether the specified service was found and therefore could be removed

Removes a service previously added.

If services are removed, you should indicate to all current connections and all bonded devices that the services in the modified range have been changed.

Note that if a service used as an included service is removed, the included service definition is not removed and will therefore be dangling. Therefore that "parent" service should also be removed, or a new service with the same UUID and size should be added back to the same position as the one being removed.

## Interface: GattServerService
This interface describes the set of properties each object item in the `services` array of `gattDb.addServices(services)` must have. All properties are only read and inspected during the service is being added.

### service.uuid
{string} or {number}

UUID of the service. Mandatory property.

### service.isSecondaryService
{boolean}

Whether the service is secondary or primary. Secondary services cannot be discovered directly but are only meant to be included by other services.

Optional property. Default: false.

### service.includedServices
{GattServerService[]}

Array of included services. Each item is a reference to either a previously added service or one of the services currently being added.

Optional property. Default: empty array.

### service.startHandle
{number}

Optional property. Positive 16-bit unsigned integer of a proposed start handle. If the property exists and the service fits at this position, it will be used. Otherwise it is placed directly after the last current service. This algorithm is run for each service in the same order as declared in the `services` argument to `gattDb.addServices`.

### service.characteristics
{GattServiceCharacteristic[]}

Array of characteristics.

Optional property. Default: empty array.

## Interface: GattServerCharacteristic
This interface describes the set of properties each object item in the array of `service.characteristics` must have.

The `uuid`, `properties`, `maxLength`, `readPerm`, `writePerm` and `descriptors` properties are only read and inspected during the service is being added.

### characteristic.uuid
{string} or {number}

UUID of the characteristic. Mandatory property.

### characteristic.properties
{string[]}

Defines properties for this characteristic. This can be used to by the client to detect the available features for this characteristic. The following property strings can be included in the array:
* `broadcast`
* `read`
* `write-without-response`
* `write`
* `notify`
* `indicate`
* `authenticated-signed-writes` (not yet supported)
* `reliable-write`
* `writable-auxiliaries`

Optional property. Default: empty array (which would be quite useless).

### characteristic.maxLength
{number}

An integer between 0 and 512 specifying the max length in bytes for this characteristic value.

Optional property. Default: 512.

### characteristic.readPerm
{string}

Defines the permission needed to read the characteristic. Must be one of the following values:
* `not-permitted` (Characteristic cannot be read)
* `open` (Can always be read)
* `encrypted` (Can only be read when the link is encrypted)
* `encrypted-mitm` (Can only be read when the link is encrypted with a key that was generated with MITM protection)
* `encrypted-mitm-sc` (Can only be read when the link is encrypted with a key that was generated with MITM protection and Secure Connections pairing)
* `custom` (A user-provided method will called upon each read to determine if the read should be permitted)

Optional property. Default: `open` if the characteristic has the `read` property, otherwise `not-permitted`.

### characteristic.writePerm
{string}

Defines the permission needed to write the characteristic. Must be one of the following values:
* `not-permitted` (Characteristic cannot be written)
* `open` (Can always be written)
* `encrypted` (Can only be written when the link is encrypted)
* `encrypted-mitm` (Can only be written when the link is encrypted with a key that was generated with MITM protection)
* `encrypted-mitm-sc` (Can only be written when the link is encrypted with a key that was generated with MITM protection and Secure Connections pairing)
* `custom` (A user-provided method will called upon each written to determine if the write should be permitted)

Optional property. Default: `open` if the characteristic has any of the the `write`, `write-without-response`, `reliable-write` properties, otherwise `not-permitted`.

### characteristic.descriptors
{GattServerDescriptor[]}

Array or descriptors.

Optional property. Default: empty array.

### characteristic.value
{Buffer} or {string}

Unless there are custom read and write handlers, the stack will read and write the value from/to this property.

Upon a write, the type will be preserved (if it previously was a string, a string will be stored, otherwise a buffer will be stored).

### characteristic.onAuthorizeRead(connection, callback)
* `connection` {Connection} The BLE connection that requests the read
* `callback` {Function} Callback that should be called with the result
  * `err` {number} An `AttErrors` result code

This method must be present if `readPerm` is set to `custom` (otherwise it is not used). Upon receiving any kind of request that reads the characteristic, this method will first be invoked to check if the read should be permitted or not.

If the callback is called with the error code `AttErrors.SUCCESS`, the read is permitted and the read will be performed as usual (unless the connection disconnects before the callback is called). Otherwise the error code will be sent as response to the client.

Allowed error codes:
* `AttErrors.SUCCESS`
* `AttErrors.READ_NOT_PERMITTED`
* `AttErrors.INSUFFICIENT_ENCRYPTION` (only if bond exists, has LTK, but the link is currently not encrypted)
* `AttErrors.INSUFFICIENT_ENCRYPTION_KEY_SIZE` (only if encrypted)
* `AttErrors.INSUFFICIENT_AUTHENTICATION`
* `AttErrors.INSUFFICIENT_AUTHORIZATION`
* Application errors (0x80 - 0x9f)

### characteristic.onRead(connection, callback)
* `connection` {Connection} The BLE connection that requests the read
* `callback` {Function} Callback that should be called with the result
  * `err` {number} An `AttErrors` result code
  * `value` {Buffer}, {string} or {undefined} The value to send as response, if no error

This optional method will be used to read the value of the characteristic when a request is received from a client. If it is not present, the stack will simply read the `value` property.

The `value` should be the current full characteristic value. Depending on request type, it will automatically be sliced depending on request offset and MTU.

Allowed error codes:
* `AttErrors.SUCCESS`
* `AttErrors.UNLIKELY_ERROR`
* `AttErrors.INSUFFICIENT_RESOURCES`
* `AttErrors.PROCEDURE_ALREADY_IN_PROGRESS`
* Application errors (0x80 - 0x9f)

### characteristic.onPartialRead(connection, offset, callback)
* `connection` {Connection} The BLE connection that requests the read
* `offset` {number} The offset from where the client wants to read
* `callback` {Function} Callback that should be called with the result
  * `err` {number} An `AttErrors` result code
  * `value` {Buffer}, {string} or {undefined} The value to send as response, if no error

This optional method always overrides the `onRead` method and can be used in particular to handle Read Blob Requests in a more specialized way. The callback should be called with the value set to the current full characteristic value, but where the first `offset` bytes have been removed.

Allowed error codes:
* `AttErrors.SUCCESS`
* `AttErrors.INVALID_OFFSET`
* `AttErrors.ATTRIBUTE_NOT_LONG` (only when offset is not 0)
* `AttErrors.UNLIKELY_ERROR`
* `AttErrors.INSUFFICIENT_RESOURCES`
* `AttErrors.PROCEDURE_ALREADY_IN_PROGRESS`
* Application errors (0x80 - 0x9f)

### characteristic.onAuthorizeWrite(connection, callback)
* `connection` {Connection} The BLE connection that requests the write
* `callback` {Function} Callback that should be called with the result
  * `err` {number} An `AttErrors` result code

This method must be present if `writePerm` is set to `custom` (otherwise it is not used). Upon receiving any kind of request or command that writes the characteristic, this method will first be invoked to check if the write should be permitted or not.

If the callback is called with the error code `AttErrors.SUCCESS`, the write is permitted and the write will be performed as usual (unless the connection disconnects before the callback is called). Otherwise the error code will be sent as response to the client.

For Write Requests and Write Without Responses, this method will be called just before the write attempt. For Long Writes and Reliable Writes, this method will be invoked for each received Prepare Write Request. When all Prepare Write Requests have been sent and the writes are later executed, the writes will be performed at once.

* `AttErrors.SUCCESS`
* `AttErrors.WRITE_NOT_PERMITTED`
* `AttErrors.INSUFFICIENT_ENCRYPTION` (only if bond exists, has LTK, but the link is currently not encrypted)
* `AttErrors.INSUFFICIENT_ENCRYPTION_KEY_SIZE` (only if encrypted)
* `AttErrors.INSUFFICIENT_AUTHENTICATION`
* `AttErrors.INSUFFICIENT_AUTHORIZATION`
* Application errors (0x80 - 0x9f)

### characteristic.onWrite(connection, needsResponse, value, callback)
* `connection` {Connection} The BLE connection that requests the write
* `needsResponse` {boolean} Whether a response must be sent
* `value` {Buffer} The value to write
* `callback` {Function} Callback that should be called with the response, if needed
  * `err` {number} An `AttErrors` result code

This optional method will be called when a write needs to be done. If this method is not present, the `value` property of the characteristic object is instead updated.

In case for Prepared Writes, consecutive writes with offsets directly following the previous write to the same value are internally concatenated to the full value at the time the writes are commited. At that time this method will be called only once with the full value.

The callback must be called when `needsResponse` is true. (Otherwise calling the callback is a NO-OP.)

Allowed error codes:
* `AttErrors.SUCCESS`
* `AttErrors.INVALID_OFFSET`
* `AttErrors.INVALID_ATTRIBUTE_VALUE_LENGTH`
* `AttErrors.UNLIKELY_ERROR`
* `AttErrors.INSUFFICIENT_RESOURCES`
* `AttErrors.PROCEDURE_ALREADY_IN_PROGRESS`
* `AttErrors.OUT_OF_RANGE`
* `AttErrors.WRITE_REQUEST_REJECTED`
* Application errors (0x80 - 0x9f)

### characteristic.onPartialWrite(connection, needsResponse, offset, value, callback)
* `connection` {Connection} The BLE connection that requests the write
* `needsResponse` {boolean} Whether a response must be sent
* `offset` {number} Offset between 0 and 512 where to start the write
* `value` {Buffer} The value to write
* `callback` {Function} Callback that should be called with the response, if needed
  * `err` {number} An `AttErrors` result code

This optional method always overrides `onWrite`. Same as `onWrite` but can be used to handle the cases where Partial Writes are used where the starting offset in the initial write is not 0. If this happens and only `onWrite` would be present, an `AttErrors.INVALID_OFFSET` error is sent in response by the stack without calling the `onWrite` method.

### characteristic.onSubscriptionChange(connection, notification, indication, isWrite)
* `connection` {Connection} The BLE connection whose GATT client has changed subscription
* `notification` {boolean} Whether the client has registered for notifications
* `indication` {boolean} Whether the client has registered for indications
* `isWrite` {boolean} Whether this was a real write to the CCCD or the change was due to a connection/disconnection

Optional method which is invoked each time the client changes the subscription status.

When the client writes to the Client Characteristic Configuration Descriptor of this characteristic, the `isWrite` argument is true.

When a client disconnects and previously had either notifications or indications subscribed, this method will be called with the last three arguments set to false.

When a bonded client connects, the previous CCCD value is read from the storage and if it was subscribed in the previous connection, this method will be called immediately after the connection gets established with the `isWrite` argument set to false.

### characteristic.notify(connection, value[, sentCallback][, completeCallback])
* `connection` {Connection} The BLE connection whose GATT client will be notified
* `value` {Buffer} or {string} Value to notify
* `sentCallback` {Function} or {undefined} A callback when the packet has been sent to the controller
* `completeCallback` {Function} or {undefined} A callback when the whole packet has been acknowledged by the peer's Link Layer or been flushed due to disconnection of the link
* Returns: {boolean} Whether the connection's GATT client was subscribed or not

This method is attached by the stack to the characteristic object when the service is being added to the GATT db if it has the `notify` property. Calling it will notify the connection's GATT client with the new value. If the client wasn't subscribed, the method will do nothing and return false.

If there is a pending Exchange MTU Request sent from this device, the notifications will be queued (per specification) and be sent when it completes. Otherwise the packet goes straight to the BLE connection's output buffer. In case you want to write a large amount of packets, you should wait for the `sentCallback` before you write another packet, to make it possible for the stack to interleave other kinds of packets. This does not decrease the throughput, as opposed to waiting for the `completeCallback` between packets.

The value will be truncated to fit MTU - 3 bytes.

### characteristic.notifyAll(value)
* `value` {Buffer} or {string} Value to notify

This method is attached by the stack to the characteristic object when the service is being added to the GATT db if it has the `notify` property. Calling it will notify all subscribers with the new value. See the `notify` method for more information.

### characteristic.indicate(connection, value[, callback])
* `connection` {Connection} The BLE connection whose GATT client will be indicated
* `value` {Buffer} or {string} Value to indicate
* `sentCallback` {Function} or {undefined} A callback that will be called when the confirmation arrives
* Returns: {boolean} Whether the connection's GATT client was subscribed or not

This method is attached by the stack to the characteristic object when the service is being added to the GATT db if it has the `indicate` property. Calling it will indicate the connection's GATT client with the new value. If the client wasn't subscribed, the method will do nothing and return false.

If there already is one or more pending indications or a pending Exchange MTU Request, the value will be enqueued and sent when the previous operations have completed. Otherwise the value is sent straight to the BLE connection's output buffer.

The value will be truncated to fit MTU - 3 bytes.

### characteristic.indicateAll(value)
* `value` {Buffer} or {string} Value to indicate

This method is attached by the stack to the characteristic object when the service is being added to the GATT db if it has the `indicate` property. Calling it will indicate all subscribers with the new value. See the `indicate` method for more information. If you need the confirmation from the different connections, use the `indicate` method for each connection.

## Interface: GattServerDescriptor
This interface describes the set of properties each object item in the array of `characteristics.descriptors` must have.

The `uuid`, `maxLength`, `readPerm` and `writePerm` properties are only read and inspected during the service is being added.

The Characteristic Extended Properties Descriptor is automatically added to a characteristic by the stack, if any declared properties needs it. This descriptor may not be added manually.

The Client Characteristic Configuration Descriptor is automatically added to a characteristic by the stack, if the notify or indicate properties are declared. This will have open read and write permissions. If custom write permissions are needed, manually add a custom Client Characteristic Configuration Descriptor with the desired permissions. However, no other than the `uuid`, `writePerm` and `onAuthorizeWrite` properties will be used in this case.

### descriptor.uuid
{string} or {number}

UUID of the descriptor. Mandatory property.

### descriptor.maxLength
Same API as `characteristic.maxLength`.

### descriptor.readPerm
Same API as `characteristic.readPerm`.

### descriptor.writePerm
Same API as `characteristic.writePerm`.

### descriptor.value
Same API as `characteristic.value`.

### descriptor.onAuthorizeRead(connection, callback)
Same API as `characteristic.onAuthorizeRead`.

### descriptor.onRead(connection, callback)
Same API as `characteristic.onRead`.

### descriptor.onPartialRead(connection, offset, callback)
Same API as `characteristic.onPartialRead`.

### descriptor.onAuthorizeWrite(connection, callback)
Same API as `characteristic.onAuthorizeWrite`.

### descriptor.onWrite(connection, needsResponse, value, callback)
Same API as `characteristic.onWrite`.

### descriptor.onPartialWrite(connection, needsResponse, offset, value, callback)
Same API as `characteristic.onPartialWrite`.
