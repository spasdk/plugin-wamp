/**
 * @author Stanislav Kalashnik <darkpark.main@gmail.com>
 * @license GNU GENERAL PUBLIC LICENSE Version 3
 */

'use strict';

var extend   = require('extend'),
    config   = require('spa-plugin/config'),
    profiles = {};


// main
profiles.default = extend(true, {}, config, {
    // listening port (0 - random)
    port: 9000
});


// public
module.exports = profiles;
