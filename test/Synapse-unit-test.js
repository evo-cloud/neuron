var assert  = require('assert'),
    sandbox = require('sandboxed-module'),
    Class   = require('js-class'),
    Try     = require('js-flow').Try,

    Synapse = require('../lib/Synapse');

describe('Synapse', function () {
    describe('Stub transport', function () {

        var StubTransport = Class({
            constructor: function () {
                this.events = {};
                this.invocations = [];
            },

            on: function (event, handler) {
                this.events[event] = handler;
                return this;
            },

            setTimeout: function (timeout) {
                this.timeout = timeout;
            },

            removeAllListeners: function () {
                this.invocations.push('removeAllListeners');
            },

            close: function () {
                this.invocations.push('close');
            },

            pause: function () {
                this.invocations.push('pause');
            },

            resume: function () {
                this.invocations.push('resume');
            },

            discard: function () {
                this.removeAllListeners();
            }
        });

        it('#constructor without transport', function () {
            var synapse = new Synapse();
            assert.equal(synapse.transport, undefined);
        });

        it('#constructor', function () {
            var conn = new StubTransport();
            var synapse = new Synapse(conn);
            assert.ok(synapse.transport);
            assert.ok(conn.events);
            ['message', 'error', 'close', 'drain', 'timeout'].forEach(function (event) {
                assert.ok(conn.events[event]);
            });
            assert.equal(conn.timeout, undefined);
        });

        it('#attach close old transport', function () {
            var conn = new StubTransport();
            var synapse = new Synapse(conn);
            synapse.setTimeout(1234);
            var newConn = new StubTransport();
            synapse.attach(newConn);
            assert.ok(synapse.transport);
            assert.deepEqual(conn.invocations, ['removeAllListeners']);
            ['message', 'error', 'close', 'drain', 'timeout'].forEach(function (event) {
                assert.ok(newConn.events[event]);
            });
            assert.equal(newConn.timeout, 1234);
        });

        it('#disconnect', function () {
            var synapse = new Synapse();
            synapse.disconnect();    // no error thrown
            var conn = new StubTransport();
            synapse.attach(conn);
            synapse.disconnect();
            assert.deepEqual(conn.invocations, ['close']);
        });

        it('#pause', function () {
            var synapse = new Synapse();
            synapse.pause();    // no error thrown
            var conn = new StubTransport();
            synapse.attach(conn);
            synapse.pause();
            assert.deepEqual(conn.invocations, ['pause']);
        });

        it('#resume', function () {
            var synapse = new Synapse();
            synapse.resume();    // no error thrown
            var conn = new StubTransport();
            synapse.attach(conn);
            synapse.resume();
            assert.deepEqual(conn.invocations, ['resume']);
        });

        it('#setTimeout', function () {
            var conn = new StubTransport();
            var synapse = new Synapse(conn);
            synapse.setTimeout();
            assert.equal(conn.timeout, 0);
            [0, null].forEach(function (val) {
                synapse.setTimeout(val);
                assert.equal(conn.timeout, 0);
            });
            ['', false, true, 'abc', {}, []].forEach(function (val) {
                assert.throws(function () {
                    synapse.setTimeout(val);
                });
            });
            synapse.setTimeout(1234);
            assert.equal(conn.timeout, 1234);
        });

        describe('#send', function () {
            var StubTrans = Class(process.EventEmitter, {
                constructor: function (result) {
                    this.result = result;
                },

                setTimeout: function () { },
                send: function (encodedMsg, callback) {
                    this.encodedMsg = encodedMsg;
                    this.callback = callback;
                    return this.result;
                },
                discard: function () { }
            });

            var msg = { event: 'test', data: { say: 'hello' } }, opts = { key: 1 };

            it('returns true', function () {
                var synapse = new Synapse(new StubTrans(true));
                var passback;
                var ret = synapse.send(msg, opts, function (err, msg, opts) {
                    passback = { err: err, msg: msg, opts: opts };
                });
                assert.strictEqual(ret, true);
                assert.ok(synapse.transport.encodedMsg);
                assert.ok(synapse.transport.callback);
                synapse.transport.callback(123, 345, 567);
                assert.ok(passback);
                assert.strictEqual(passback.err, 123);
                assert.strictEqual(passback.msg, msg);
                assert.strictEqual(passback.opts, opts);
                assert.deepEqual(Synapse.decodeMessage(synapse.transport.encodedMsg), msg);
                assert.equal(synapse._sendQueue.length, 0);
            });

            it('returns false', function () {
                var synapse = new Synapse(new StubTrans(false));
                var passback;
                var ret = synapse.send(msg, opts, function (err, msg, opts) {
                    passback = { err: err, msg: msg, opts: opts };
                });
                assert.strictEqual(ret, false);
                assert.ok(synapse.transport.encodedMsg);
                assert.ok(synapse.transport.callback);
                synapse.transport.callback(null);
                assert.ok(passback);
                assert.strictEqual(passback.err, null);
                assert.strictEqual(passback.msg, msg);
                assert.strictEqual(passback.opts, opts);
                assert.deepEqual(Synapse.decodeMessage(synapse.transport.encodedMsg), msg);
                assert.ok(synapse._sendBusy);
                assert.equal(synapse._sendQueue.length, 0);
            });

            it('returns undefined', function () {
                var synapse = new Synapse(new StubTrans(undefined));
                var passback;
                var ret = synapse.send(msg, opts, function (err, msg, opts) {
                    passback = { err: err, msg: msg, opts: opts };
                });
                assert.strictEqual(ret, undefined);
                assert.ok(synapse.transport.encodedMsg);
                assert.ok(synapse.transport.callback);
                synapse.transport.callback(null);
                assert.ok(passback);
                assert.strictEqual(passback.err, null);
                assert.strictEqual(passback.msg, msg);
                assert.strictEqual(passback.opts, opts);
                assert.deepEqual(Synapse.decodeMessage(synapse.transport.encodedMsg), msg);
                assert.equal(synapse._sendQueue.length, 0);
            });

            it('queue messages', function () {
                var synapse = new Synapse(new StubTrans(false));
                var passback;
                var ret = synapse.send(msg, opts, function () { });
                assert.strictEqual(ret, false);
                assert.ok(synapse._sendBusy);
                assert.ok(synapse.transport.encodedMsg);
                assert.ok(synapse.transport.callback);
                delete synapse.transport.encodedMsg;
                delete synapse.transport.callback;
                ret = synapse.send(msg, function (err, msg, opts) {
                    passback = { err: err, msg: msg, opts: opts };
                });
                assert.strictEqual(ret, false);
                assert.equal(synapse.transport.encodedMsg, undefined);
                assert.equal(synapse.transport.callback, undefined);
                assert.equal(synapse._sendQueue.length, 1);

                synapse.transport.result = true;
                synapse.transport.emit('drain');
                assert.equal(synapse._sendQueue.length, 0);
                assert.ok(!synapse._sendBusy);
                assert.ok(synapse.transport.encodedMsg);
                assert.ok(synapse.transport.callback);
                synapse.transport.callback(null);
                assert.ok(passback);
                assert.strictEqual(passback.err, null);
                assert.strictEqual(passback.msg, msg);
                assert.strictEqual(passback.opts, undefined);
            });

            it('abandon messages', function (done) {
                var synapse = new Synapse(new StubTrans(false));
                var callback = function (err) {
                    Try.final(function () {
                        assert.ok(err);
                        assert.equal(err.message, 'abandon');
                    }, done);
                };
                synapse.send(msg, callback);
                synapse.send(msg, callback);
                assert.ok(synapse._sendBusy);
                assert.equal(synapse._sendQueue.length, 1);
                synapse.transport.emit('close');
                assert.ok(!synapse._sendBusy);
                assert.ok(!synapse.transport);
            });
        });

        describe('events', function () {
            var StubTrans = Class(process.EventEmitter, {
                setTimeout: function () { },
                close: function () {
                    process.nextTick(function () {
                        this.emit('close');
                    }.bind(this));
                },
                discard: function () { }
            });

            var synapse;

            beforeEach(function () {
                synapse = new Synapse(new StubTrans());
            });

            it('#message', function (done) {
                var msg = { event: 'test', data: { key: 1087 } };
                synapse
                    .on('message', function (recvMsg) {
                            Try.final(function () {
                                assert.deepEqual(recvMsg, msg);
                            }, done);
                        })
                    .transport.emit('message', Synapse.encodeMessage(msg));
            });

            it('#error', function (done) {
                var err = new Error('test');
                synapse
                    .on('error', function (recvErr) {
                            Try.final(function () {
                                assert.ok(recvErr);
                                assert.equal(recvErr.message, err.message);
                            }, done);
                        })
                    .transport.emit('error', err);
            });

            it('#close', function (done) {
                synapse
                    .on('close', function (hadError) {
                            Try.final(function () {
                                assert.equal(hadError, 'something');
                            }, done);
                        })
                    .transport.emit('close', 'something');
                assert.ok(!synapse.transport);
            });

            it('#timeout', function (done) {
                synapse
                    .on('close', done)
                    .transport.emit('timeout');
            });
        });
    });

    describe('Connector', function () {
        var StubConnection = Class(process.EventEmitter, {
            constructor: function () {
                this.invocations = [];
                this.packets = [];
                this.result = true;
            },

            setTimeout: function (timeout) {
                this.timeout = timeout;
            },

            write: function (data, callback) {
                this.packets.push({ data: data, callback: callback });
                return this.result;
            },

            end: function () { this.invocations.push('end'); },
            destroy: function () { this.invocations.push('destroy'); },
            pause: function () { this.invocations.push('pause'); },
            resume: function () { this.invocations.push('resume'); }
        });

        function createConnector(conn, connectUri, opts) {
            var SandboxedSynapse = sandbox.require('../lib/Synapse', {
                requires: {
                    'net': {
                        connect: function () {
                            conn.connectArgs = [].slice.call(arguments);
                            return conn;
                        }
                    }
                }
            });
            return SandboxedSynapse.connect(connectUri, opts);
        }

        describe('connectUri', function () {
            var conn;

            beforeEach(function () {
                conn = new StubConnection();
            });

            it('unix socket', function () {
                var connector = createConnector(conn, 'unix:/path/socket.sock');
                assert.deepEqual(conn.connectArgs, ['/path/socket.sock']);
            });

            it('tcp', function () {
                var connector = createConnector(conn, 'tcp://host:1234');
                assert.deepEqual(conn.connectArgs, [1234, 'host']);
            });

            it('tcp without host', function () {
                var connector = createConnector(conn, 'tcp://:1234');
                assert.deepEqual(conn.connectArgs, [1234]);
            });

            it('invalid uri', function () {
                assert.throws(function () {
                    createConnector(conn, 'invalid uri');
                });
                assert.throws(function () {
                    createConnector(conn, 'unknown://invalid/uri');
                });
            });
        });

        it('re-send message', function (done) {
            var msg = { event: 'test', data: { key: 'ok' } };
            var conn = new StubConnection();
            var connector = createConnector(conn, 'unix:/local', { reconnectDelay: 20 });
            var ret = connector.send(msg);
            assert.strictEqual(ret, false);
            assert.ok(!connector._connected);
            assert.equal(connector._sendQueue.length, 1);
            conn.emit('connect');
            assert.ok(connector._connected);
            assert.equal(connector._sendQueue.length, 0);
            assert.equal(conn.packets.length, 1);
            conn.emit('close');
            assert.ok(!connector._connected);
            assert.ok(!connector.transport);
            ret = connector.send(msg);
            assert.strictEqual(ret, false);
            assert.equal(connector._sendQueue.length, 1);
            setTimeout(function () {
                Try.final(function () {
                    assert.ok(connector.transport);
                    assert.ok(!connector._connected);
                    conn.emit('connect');
                    assert.ok(connector._connected);
                    assert.equal(connector._sendQueue.length, 0);
                    assert.equal(conn.packets.length, 2);

                    conn.packets.forEach(function (pkt) {
                        assert.ok(Buffer.isBuffer(pkt.data));
                        assert.ok(pkt.data.length > 4);
                        var len = pkt.data.readUInt32BE(0);
                        assert.strictEqual(len & 0xff000000, 0);
                        assert.equal(len + 4, pkt.data.length);
                        var decodedMsg = Synapse.decodeMessage(pkt.data.slice(4));
                        assert.deepEqual(decodedMsg, msg);
                    });
                }, done);
            }, 30);
        });

        it('queued message timeout', function (done) {
            var msg = { event: 'test', data: {} };
            var conn = new StubConnection();
            var connector = createConnector(conn, 'unix:/local');
            var ret = connector.send(msg, { timeout: 5 });
            assert.strictEqual(ret, false);
            assert.ok(!connector._connected);
            assert.equal(connector._sendQueue.length, 1);
            setTimeout(function () {
                conn.emit('connect');
                Try.final(function () {
                    assert.ok(connector._connected);
                    assert.equal(connector._sendQueue.length, 0);
                    assert.equal(conn.packets.length, 0);
                }, done);
            }, 10);
        });

        it('message queue full', function (done) {
            var conn = new StubConnection();
            var connector = createConnector(conn, 'unix:/local', { sendQueueMax: 4 });
            for (var i = 0; i < 4; i ++) {
                var opts = i == 2 ? { timeout: 5 } : undefined;
                var ret = connector.send({ event: 'test', data: { key: i } }, opts);
                assert.strictEqual(ret, false);
            }
            assert.equal(connector._sendQueue.length, 4);
            setTimeout(function () {
                Try.final(function () {
                    var ret = connector.send({ event: 'test', data: { key: 4 } });
                    assert.strictEqual(ret, false);
                    assert.equal(connector._sendQueue.length, 4);
                    ret = connector.send({ event: 'test', data: { key: 5 } });
                    assert.strictEqual(ret, undefined);
                    assert.equal(connector._sendQueue.length, 4);
                    assert.deepEqual(connector._sendQueue.map(function (msg) { return msg.message.data.key; }), [0, 1, 3, 4]);
                }, done);
            }, 10);
        });
    });

    describe('Receptor', function () {
        var StubServer = Class(process.EventEmitter, {
            listen: function () {
                this.listenArgs = [].slice.call(arguments);
            }
        });

        var StubConnection = Class(process.EventEmitter, {
            setTimeout: function () { }
        });

        function createReceptor(server, listenUri) {
            var SandboxedSynapse = sandbox.require('../lib/Synapse', {
                requires: {
                    'net': {
                        createServer: function () {
                            return server;
                        }
                    }
                }
            });
            return SandboxedSynapse.listen(listenUri);
        }

        it('parse listening Uri', function () {
            var receptor = createReceptor(new StubServer(), 'unix:/path/socket.sock');
            assert.deepEqual(receptor.listener.listenArgs, ['/path/socket.sock']);
            receptor = createReceptor(new StubServer(), 'tcp://:4567');
            assert.deepEqual(receptor.listener.listenArgs, [4567]);
            receptor = createReceptor(new StubServer(), 'tcp://host:4567');
            assert.deepEqual(receptor.listener.listenArgs, [4567, 'host']);
            assert.throws(function () {
                createReceptor(new StubServer(), 'invalid:');
            }, /invalid listening uri/i);
        });

        it('receive a message', function (done) {
            var msg = { event: 'test', data: { key: 456 } };
            var receptor = createReceptor(new StubServer(), 'unix:/path/socket.sock');
            var conn = new StubConnection();

            receptor
                .on('connection', function (synapse) {
                        synapse.on('message', function (recvMsg) {
                            Try.final(function () {
                                assert.deepEqual(recvMsg, msg);
                            }, done);
                        });
                        var bufs = [new Buffer(4), Synapse.encodeMessage(msg)];
                        bufs[0].writeUInt32BE(bufs[1].length, 0);
                        conn.emit('data', Buffer.concat(bufs));
                    })
                .listener.emit('connection', conn);
        });
    });
});