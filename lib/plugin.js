/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var Wamp     = require('cjs-wamp'),
    //Plugin   = require('spasdk/lib/plugin'),
    //app      = require('spasdk/lib/app'),
    //plugin   = new Plugin({name: 'wamp', entry: 'serve', config: require('./config')}),
    PluginTemplate = require('spa-plugin'),
    clientId = 1,
    targetId = 1,
    clients  = {},
    targets  = {};


/**
 * @constructor
 * @extends PluginTemplate
 *
 * @param {Object} config init parameters (all inherited from the parent)
 */
function Plugin ( config ) {
    var self = this;

    // parent constructor call
    PluginTemplate.call(this, config);

    // create tasks for profiles
    this.profiles.forEach(function ( profile ) {
        var server, serverDone;

        // main entry task
        profile.task(self.entry, function ( done ) {
            server = new (require('ws').Server)({port: profile.data.port});
            serverDone = done;

            // ready
            server.on('listening', function listening () {
                self.debug('start server on port ' + server._server.address().port);
            });

            // new connect
            server.on('connection', function ( connection ) {
                // wrap
                connection = {
                    wamp: new Wamp(connection),
                    type: connection.upgradeReq.url.slice(1).split('/')[0],
                    host: connection.upgradeReq.connection.remoteAddress,
                    data: {}  // client or target data
                };

                // setup pool
                switch ( connection.type ) {
                    case 'client':
                        connection.id = clientId++;
                        clients[connection.id] = connection;
                        break;
                    case 'target':
                        connection.id = targetId++;
                        targets[connection.id] = connection;
                        break;
                    default:
                        self.debug('wrong connection type');
                        connection.wamp.socket.close();
                        return;
                }

                self.debug('new ' + connection.type + ' connection #' + connection.id + ' from ' + connection.host);

                // general API methods and events
                connection.wamp.addListeners({
                    getInfo: function ( params, callback ) {
                        callback(null, {
                            path: self.app.paths.root,
                            package: self.app.package
                        });
                    },
                    getMemoryUsage: function ( params, callback ) {
                        callback(null, process.memoryUsage());
                    },
                    getClients: function ( params, callback ) {
                        var data = {},
                            id;

                        for ( id in clients ) {
                            data[id] = {
                                host: clients[id].host,
                                data: clients[id].data
                            };
                        }

                        callback(null, data);
                    },
                    getTargets: function ( params, callback ) {
                        var data = {},
                            id;

                        for ( id in targets ) {
                            data[id] = {
                                host: targets[id].host,
                                data: targets[id].data
                            };
                        }

                        callback(null, data);
                    },
                    getPlugins: function ( params, callback ) {
                        var data = {},
                            name;

                        for ( name in self.app.plugins ) {
                            data[name] = {
                                name: self.app.plugins[name].name,
                                //config: app.plugins[name].config
                                config: 'Converting circular structure to JSON in SASS'
                            };
                        }

                        callback(null, data);
                    },
                    getTasks: function ( params, callback ) {
                        var data = {},
                            id;

                        for ( id in self.app.runner.tasks ) {
                            data[id] = {
                                running: !!self.app.runner.tasks[id].running
                            };
                        }
                        callback(null, data);
                    },
                    runTask: function ( params, callback ) {
                        self.app.runner.run(params.id);

                        // todo: return run status
                        callback(null, true);
                    }
                });

                // API for clients only
                if ( connection.type === 'client' ) {
                    connection.wamp.addListeners({
                        getPackages: function ( params, callback ) {
                            // ...

                            callback(null, {});
                        }
                    });
                }

                // API for targets only
                if ( connection.type === 'target' ) {
                    connection.wamp.addListeners({
                        setTarget: function ( params, callback ) {
                            clients.forEach(function ( client ) {
                                client.wamp.call('eventTargetOnline', {});
                            });
                        }
                    });
                }

                connection.wamp.socket.on('error', function ( event ) {
                    self.debug('wamp.socket error', event);
                });

                connection.wamp.socket.on('close', function () {
                    var id;

                    if ( connection.type === 'client' ) {
                        delete clients[connection.id];
                    } else if ( connection.type === 'target' ) {
                        delete targets[connection.id];

                        for ( id in clients ) {
                            clients[id].wamp.call('eventTargetOffline', {id: connection.id});
                        }
                    }

                    self.debug('end ' + connection.type + ' connection #' + connection.id + ' from ' + connection.host);
                });

                // notify all clients about new targets
                if ( connection.type === 'target' ) {
                    Object.keys(clients).forEach(function ( id ) {
                        clients[id].wamp.call('eventTargetOnline', {
                            id:   connection.id,
                            host: connection.host
                        });
                    });
                }
            });

            self.app.runner.addListener('start', function ( event ) {
                Object.keys(clients).forEach(function ( id ) {
                    clients[id].wamp.call('eventTaskStart', event);
                });
            });

            self.app.runner.addListener('finish', function ( event ) {
                Object.keys(clients).forEach(function ( id ) {
                    clients[id].wamp.call('eventTaskFinish', event);
                });
            });
        });

        profile.task('stop', function () {
            if ( server ) {
                profile.notify({
                    title: 'stop',
                    info: 'stop'
                });

                server.close();
                server = null;
                serverDone();
            }
        });
    });

    this.debug('tasks: ' + Object.keys(this.tasks).sort().join(', '));
}


// inheritance
Plugin.prototype = Object.create(PluginTemplate.prototype);
Plugin.prototype.constructor = Plugin;


Plugin.prototype.message = function ( data ) {
    Object.keys(clients).forEach(function ( id ) {
        clients[id].wamp.call('message', data);
    });
};


// public
module.exports = Plugin;
