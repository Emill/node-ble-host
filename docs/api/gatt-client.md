# GATT client

This implements support for a GATT client.

### Requests
Since there can only be one outstanding ATT Request at a time, requests made using the API are internally enqueued if there is another pending request. There is no upper limit for the number of requests that can be enqueued. All request operations take a callback argument, to which either a Function or `undefined` should be passed. The first argument passed to the callback (if it is a Function) will be an `AttErrors` code, unless otherwise stated, which contains the response error, or 0 on success.

### MTU
The default MTU for each new connection is 23. A change of this MTU can be initiated by either the server or client. This implementation always tries to negotiate the MTU of 517 bytes (upon request), since with that MTU the largest possible attribute value will always fit in each type of request/response. The current MTU can be retrieved through the `currentMtu` property of the GattConnection object.

If you need to compare the length of some response with the current MTU value, make sure the MTU has been negotiated before the request is started to avoid cases when the MTU is changed in the middle of a procedure by the peer.

### UUIDs
All UUIDs that this API outputs are always full 128-bit UUIDs written as uppercase strings in the format `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`. All UUID inputs are required to be either strings in the same format (but lowercase are allowed), or a 16-bit unsigned integer number (in which case it is assumed to be an UUID in Bluetooth SIG's base range).

### Values
All characteristic and descriptor values that this API outputs are always Buffer objects. All value inputs may be either Buffers or strings. If the value is a string, it is converted to a Buffer using the UTF-8 encoding.

## Class: GattConnection

This class is used to perform GATT client operations. Each BLE connection object has an instance of a GattConnection, which can be retrieved through its `gatt` property.

### gatt.exchangeMtu([callback])
Performs an MTU exchange request. Since the specification only allows this request to be sent once per connection, an error will be thrown if this method is called multiple times. When the operation has completed, the MTU is available in the `currentMtu` property.

See the MTU topic above for more information.

### gatt.discoverAllPrimaryServices(callback)
Performs the Discover All Primary Service procedure, which internally issues multiple requests to discover all primary services. The services will be cached for the current connection. The cache will also be persisted between connections if bonded. If a cached version is available, the callback will be called immediately, bypassing the queue of requests.

Callback should take a single argument `services` which is an array of all services found when the procedure completes. Each item will be of type `GattClientService`.

### gatt.discoverServicesByUuid(uuid, numToFind, callback)
* `uuid` {string} or {number} UUID of the service to find
* `numToFind` {number} or {undefined} If this is present, the search may stop earlier if at least this number of service instances have already been found
* `callback` {Function} or {undefined}

Performs the Discover Primary Service By Service UUID procedure, which internally issues multiple requests to discover primary services of the given UUID.

Works just like `discoverAllPrimaryServices` with the exception that the `services` array will only contain services of the given UUID.

### gatt.invalidateServices(startHandle, endHandle[, callback])
* `startHandle` {number} Positive 16-bit unsigned integer where the invalidated range starts
* `endHandle` {number} Positive 16-bit unsigned integer where the invalidated range ends (must not be less than the start handle)
* `callback` {Function} or {undefined} Callback taking no arguments

Invalidates services from the service cache. Notifications and Indications will no longer be emitted for characteristics in this range. The operation will be enqueued in the request queue, meaning all pending requests will be performed before the services are invalidated. The callback will be called with no arguments when all pending requests have been executed and the services have been invalidated.

### gatt.readUsingCharacteristicUuid(startHandle, endHandle, uuid, callback)
* `startHandle` {number} Positive 16-bit unsigned integer where the search should start
* `endHandle` {number} Positive 16-bit unsigned integer where the search should end (must not be less than the start handle)
* `uuid` {string} or {number} Characteristic UUID
* `callback` {Function}
  * `err` {number} An `AttErrors` code
  * `list` {Object[]} or {undefined} Non-empty array of results if no error
    * `attributeHandle` {number} Attribute handle
    * `attributeValue` {Buffer} Attribute value

Performs a Read Using Characteristic UUID request to read characteristics of a given UUID in a specific handle range. Multiple values may be received in the same response if they have the same length and fits into one packet. Values are truncated to `min(253, ATT_MTU - 4)` bytes.

### gatt.beginReliableWrite()
Tells the stack that a Reliable Write transaction is started. All characteristic writes except "Write Without Response" to characteristics following this method call will become one Reliable Write transaction, which means they will be queued up at the GATT server and executed atomically when the `commitReliableWrite` method is called. Long Writes to descriptors are not allowed while Reliable Write is active.

### gatt.cancelReliableWrite([callback])
Performs a request to cancel Reliable Writes, which means all pending writes (if any) at the server are discarded.

### gatt.commitReliableWrite([callback])
Performs a request to execute all pending writes at the server. From now on, all writes are "normal" again until `beginReliableWrite` is called again.

### gatt.currentMtu
The current MTU.

### Event: 'timeout'
Emitted when a GATT request times out (30 seconds after it was sent). When this happens, no more procedures may be executed on this BLE connection (so it's best to disconnect and reconnect). If there are no listeners for this event, the BLE connection will be disconnected.

## Class: GattClientService

This class represents a service present on a remote GATT server. Instances of this class can only be obtained using discovery procedures.

### service.startHandle
The start handle of the service.

### service.endHandle
The end handle of the service.

### service.uuid
The UUID of the service.

### service.findIncludedServices(callback)
Performs the Find Included Services procedure, which internally issues multiple requests to find all included services for this service. Just like when discovering all primary services, the result may be cached.

Callback should take a single argument `services` which is an array of all services found when the procedure completes. Each item will be of type `GattClientService`.

### service.discoverCharacteristics(callback)
Performs the Discover All Characteristics of a Service procedure, which internally issues multiple requests to discover all characteristics of this service. Just like when discovering all primary services, the result may be cached.

Callback should take a single argument `characteristics` which is an array of all characteristics found when the procedure completes. Each item will be of type `GattClientCharacteristic`.

## Class: GattClientCharacteristic

This class represents a characteristic present on a remote GATT server. Instances of this class can be obtained by the method `discoverCharacteristics` of a service.

### characteristic.properties
The declared properties for this characteristic. The property is an object containing the following keys. The corresponding value for each key is a boolean whether the property is declared or not.
* broadcast
* read
* writeWithoutResponse
* write
* notify
* indicate
* authenticatedSignedWrites
* extendedProperties

To get the extended properties, the Extended Properties descriptor must be manually discovered, read and parsed.

### characteristic.declarationHandle
The declaration handle of this characteristic

### characteristic.valueHandle
The value handle of this characteristic

### characteristic.uuid
The UUID of this characteristic

### characteristic.discoverDescriptors(callback)
Performs the Discover All Characteristic Descriptors procedure, which internally issues multiple requests to discover all descriptors of this characteristic. Just like when discovering all primary services, the result may be cached.

Callback should take a single argument `descriptors` which is an array of all descriptors found when the procedure completes. Each item will be of type `GattClientDescriptor`.

### characteristic.read(callback)
* `callback` {Function}
  * `err` {number} An `AttErrors` code
  * `value` {Buffer} or {undefined} The read value if no error

This performs the Read Long Characteristics Value procedure, which internally first issues a Read Request. If the value returned is as large as fits within one packet, the remainder is read using multiple Read Blob Requests. When completed, the complete value is forwarded to the callback.

### characteristic.readShort(callback)
Same as the `read` method but only performs one Read Request, which means the value passed to the callback might be truncated.

### characteristic.readLong(offset, callback)
Same as the `read` method but starts reading at a specific offset (integer between 0 and 512). The value passed to the callback will contain the characteristic value where the first `offset` bytes have been omitted.

### characteristic.write(value[, callback])
* `value` {Buffer} or {string} The value to write
* `callback` {Function} or {undefined} Callback
  * `err` {number} An `AttErrors` code

If Reliable Write is not active, performs either the Write Characteristic Value or the Write Long Characteristic Value procedure, depending on the value length and current MTU.

If Reliable Write is active, Prepare Write Requests will be sent. The returned value will be compared to the sent value, per specification, and if the values don't match, the callback will be called with the error `AttErrors.RELIABLE_WRITE_RESPONSE_NOT_MATCHING`. If that happens, the Reliable Write state is also exited and all pending writes at the server are discarded.

### characteristic.writeLong(value, offset[, callback])
Same as `write` but starts writing to a particular offset (integer between 0 and 512).

### characteristic.writeWithoutResponse(value[, sentCallback][, completeCallback])
* `value` {Buffer} or {string} The value to write
* `sentCallback` {Function} or {undefined} A callback when the packet has been sent to the controller
* `completeCallback` {Function} or {undefined} A callback when the whole packet has been acknowledged by the peer's Link Layer or been flushed due to disconnection of the link

Performs the Write Without Response procedure, which is not a request. Therefore the packet goes straight to the BLE connection's output buffer, bypassing the request queue. In case you want to write a large amount of packets, you should wait for the `sentCallback` before you write another packet, to make it possible for the stack to interleave other kinds of packets. This does not decrease the throughput, as opposed to waiting for the `completeCallback` between packets.

The value will be truncated to `currentMtu - 3` bytes.

### characteristic.writeCCCD(enableNotifications, enableIndications[, callback])
* `enableNotifications` {boolean} If notifications should be enabled
* `enableIndications` {boolean} If indications should be enabled
* `callback` {Function}
  * `err` {number} An `AttErrors` code

Utility function for first finding a Client Characteristic Configuration Descriptor, then writing the desired value to it.

If no descriptor is found, the callback will be called with `AttErrors.ATTRIBUTE_NOT_FOUND` as error code. Otherwise, the code passed to the callback will be the result of the write.

### Event: 'change'
* `value` {Buffer} The value notified / indicated
* `isIndication` {boolean} If it is an indication (true) or notification (false)
* `callback` {Function} Callback taking no arguments to be called if `isIndication`

This event is emitted when a notification or indication is received for a characteristic. If it is an indication, a confirmation must be sent by calling the `callback` with no arguments within 30 seconds.

Note that listening to this event does not mean that the Client Characteristic Configuration Descriptor is configured automatically. You need to first write to this descriptor to subscribe for notifications / indications.

## Class: GattClientDescriptor

This class represents a descriptor present on a remote GATT server. Instances of this class can be obtained by the method `discoverDescriptors` of a characteristic.

### descriptor.handle
The handle for this descriptor.

### descriptor.uuid
The UUID for this descriptor.

### descriptor.read(callback)
Same API as `read` for `GattClientCharacteristic`.

### descriptor.readShort(callback)
Same API as `readShort` for `GattClientCharacteristic`.

### descriptor.readLong(offset, callback)
Same API as `readLong` for `GattClientCharacteristic`.

### descriptor.write(value[, callback])
Same API as `write` for `GattClientCharacteristic` except that in case of Reliable Write is active, "Long" descriptor values are not allowed to be written (values larger than MTU - 3 bytes), and that "Short" descriptor values in this case are written using the normal Write Request.

### descriptor.writeLong(value, offset[, callback])
If offset is 0, same as `write`. Otherwise, same API as `writeLong` for `GattClientCharacteristic` except that in case of Reliable Write is active, this method is not allowed.
