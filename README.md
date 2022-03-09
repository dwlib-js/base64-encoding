# Base64 Encoding

## Install
`npm i --save @dwlib/base64-encoding`

## Usage
```javascript
// CJS
const base64Encoding = require('@dwlib/base64-encoding');
// ESM
import Base64Encoding from '@dwlib/base64-encoding';
import * as base64Encoding from '@dwlib/base64-encoding';
// Module Exports
const {
  Base64Encoding,
  BASIC,
  URL
} = base64Encoding;

Base64Encoding.BASIC.alphabet; // => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
Base64Encoding.BASIC.padding; // => '='
Base64Encoding.URL.alphabet; // => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
Base64Encoding.URL.padding; // => ''
```
