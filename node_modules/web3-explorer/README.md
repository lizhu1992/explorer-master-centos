# web3-explorer.js

![web3.js logo](https://raw.githubusercontent.com/ethereum/web3.js/1.0/assets/web3js.svg?sanitize=true)

[![npm version](https://badge.fury.io/js/web3-explorer.svg)](https://badge.fury.io/js/web3-explorer)

[Web3](https://github.com/ethereum/web3.js) 1.0-beta36 provides a way to extend its builtin RPC method wrappers.

This library tries to support all RPC methods not supported by by web3.js.

Currently it only adds the `debug`, `trace`, and `parity` namespace supported by [parity-ethereum](https://github.com/paritytech/parity-ethereum) and [go-ethereum](https://github.com/ethereum/go-ethereum) node.

## Usage

`npm install web3-explorer`

## Importing library

`var web3explorer = require('web3-explorer');`

`web3explorer(web3);`

## Author(s)

Alex Beregszaszi <alex@rtfs.hu>

Alexis Roussel <alexis@bity.com>

Peter Pratscher <peter@bitfly.at>

Wonkyu Park <hackyminer@gmail.com>

BT Enterprise <btenterprise2020@gmail.com>

## License

LGPL 3.0
