/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var Plugin = require('spasdk/lib/plugin'),
    plugin = new Plugin({name: 'wamp', entry: 'serve', config: require('./config')});


// create tasks for profiles
plugin.profiles.forEach(function ( profile ) {
    var server;

    // correct target
    //plugin.prepare(profile.name);

    // main entry task
    profile.task(plugin.entry, function ( done ) {

    });

    profile.task('stop', function () {
        if ( server ) {
            profile.notify({
                info: 'stop '.green + srcDir.bold,
                title: 'stop',
                message: 'stop ' + srcDir
            });

            server.close();
        }
    });
});


// public
module.exports = plugin;
