import {
  BigInt,
  Map,
  MapGet,
  MapHas,
  MapSet,
  MathCeil,
  MathFloor,
  ObjectDefineProperties,
  RangeError,
  ReflectDefineProperty,
  StringFromCharCode,
  StringCharCodeAt,
  Symbol,
  SymbolHasInstance,
  SymbolToStringTag,
  TypeError,
  TypedArrayLength,
  TypedArraySlice,
  Uint8Array,
  Uint8ArrayOf
} from '@dwlib/primordials';
import IsBuffer from '@dwlib/abstract/IsBuffer';
import IsUint8Array from '@dwlib/abstract/IsUint8Array';
import IsString from '@dwlib/abstract/IsString';
import ToString from '@dwlib/abstract/ToString';
import ToIntegerOrInfinity from '@dwlib/abstract/ToIntegerOrInfinity';
import ToBigInt from '@dwlib/abstract/ToBigInt';
import IsObject from '@dwlib/abstract/IsObject';
import {
  DefineSlots,
  GetSlot,
  HasSlot
} from '@dwlib/internal-slots';
import {
  encode as UTF8Encode,
  decode as UTF8Decode
} from '@dwlib/utf8';

const FACTOR = 4 / 3;
const INVERSE_FACTOR = 3 / 4;

const DEFAULT_PADDING = '=';
const DEFAULT_PADDING_CHAR_CODE = 0x3d;

const ENCODING_SHIFTS = Uint8ArrayOf(2, 4, 6);
const ENCODING_MASKS = Uint8ArrayOf(3, 0xf, 0x3f);
const ENCODING_DIGITS = Uint8ArrayOf(4, 2, 0);

const DECODING_SHIFTS = Uint8ArrayOf(2, 4, 6, 0);
const DECODING_MASKS = Uint8ArrayOf(0, 0xf, 3, 0);
const DECODING_DIGITS = Uint8ArrayOf(0, 4, 2, 0);

const PADDING = Symbol();

const $Alphabet = Symbol('[[Alphabet]]');
const $AlphabetLookup = Symbol('[[AlphabetLookup]]');
const $BaseMap = Symbol('[[BaseMap]]');
const $BaseMapLookup = Symbol('[[BaseMapLookup]]');
const $Padding = Symbol('[[Padding]]');
const $PaddingCharCode = Symbol('[[PaddingCharCode]]');

const IsBase64Encoding = argument => IsObject(argument) && HasSlot(argument, $Alphabet);

const RequireThis = argument => {
  if (!IsBase64Encoding(argument)) {
    throw new TypeError('`this` is not an instance of Base64Encoding');
  }
}

const RequireBuffer = argument => {
  if (!IsBuffer(argument)) {
    throw new TypeError('`buffer` is not an instance of ArrayBuffer or ArrayBufferView');
  }
}

const RequireOptionsObject = argument => {
  if (!IsObject(argument)) {
    throw new TypeError('`options` is not an object');
  }
}

const GetEncodingBytes = (length, index) => {
  const remaining = length - index;
  return remaining < 3 ? remaining : 3;
}

const GetDecodingBytes = (length, index) => {
  const remaining = length - index;
  return remaining < 4 ? remaining : 4;
}

const GetPaddedLength = length => {
  const remainder = length % 4;
  return remainder ? length + (4 - remainder) : length;
}

const GetCapacity = (length, withPadding) => {
  const capacity = MathCeil(length * FACTOR);
  return withPadding ? GetPaddedLength(capacity) : capacity;
}

const GetInverseCapacity = length => MathCeil(length * INVERSE_FACTOR);

const Encode = (target, string, withPadding) => {
  const length = string.length;
  if (!length) {
    return '';
  }
  const alphabet = GetSlot(target, $Alphabet);
  let result = '';
  let position = 0;
  for (let i = 0; i < length; i += 3) {
    const bytes = GetEncodingBytes(length, i);
    let carry = 0;
    for (let j = 0; j < bytes; j++) {
      const charCode = StringCharCodeAt(string, position++);
      if (charCode > 0xff) {
        throw new RangeError('Invalid ASCII encoding');
      }
      const charIndex = carry + (charCode >> ENCODING_SHIFTS[j]);
      result += alphabet[charIndex];
      carry = (charCode & ENCODING_MASKS[j]) << ENCODING_DIGITS[j];
    }
    result += alphabet[carry];
  }
  if (withPadding) {
    const paddedLength = GetPaddedLength(result.length);
    if (result.length < paddedLength) {
      const padding = GetSlot(target, $Padding) || '\0';
      while (result.length < paddedLength) {
        result += padding;
      }
    }
  }
  return result;
}

const EncodeToBytes = (target, string, withPadding) => {
  const length = string.length;
  if (!length) {
    return new Uint8Array(0);
  }
  const baseMap = GetSlot(target, $BaseMap);
  const capacity = GetCapacity(length, withPadding);
  const result = new Uint8Array(capacity);
  let index = 0;
  let position = 0;
  for (let i = 0; i < length; i += 3) {
    const bytes = GetEncodingBytes(length, i);
    let carry = 0;
    for (let j = 0; j < bytes; j++) {
      const charCode = StringCharCodeAt(string, position++);
      if (charCode > 0xff) {
        throw new RangeError('Invalid ASCII encoding');
      }
      const charIndex = carry + (charCode >> ENCODING_SHIFTS[j]);
      result[index++] = MapGet(baseMap, charIndex);
      carry = (charCode & ENCODING_MASKS[j]) << ENCODING_DIGITS[j];
    }
    result[index++] = MapGet(baseMap, carry);
  }
  if (withPadding && index < capacity) {
    const paddingCharCode = GetSlot(target, $PaddingCharCode);
    if (paddingCharCode) {
      while (index < capacity) {
        result[index++] = paddingCharCode;
      }
    }
  }
  return result;
}

const Decode = (target, encodedString, ignorePadding, allowConcatenation) => {
  const length = encodedString.length;
  if (!length) {
    return '';
  }
  const baseMapLookup = GetSlot(target, $BaseMapLookup);
  const padding = GetSlot(target, $Padding) || '\0';
  const paddingCharCode = GetSlot(target, $PaddingCharCode) || 0;
  let result = '';
  let position = 0;
  for (let i = 0; i < length; i += 4) {
    try {
      const bytes = GetDecodingBytes(length, position);
      let carry = 0;
      for (let j = 0; j < bytes; j++) {
        const charCode = StringCharCodeAt(encodedString, position++);
        const charIndex = MapGet(baseMapLookup, charCode);
        if (charIndex === undefined) {
          if (charCode === paddingCharCode && !ignorePadding) {
            throw PADDING;
          }
          throw new RangeError('Invalid Base64 encoding');
        }
        const mask = DECODING_MASKS[j];
        const shift = DECODING_SHIFTS[j];
        if (mask) {
          const charCode = carry + (charIndex >> DECODING_DIGITS[j]);
          result += StringFromCharCode(charCode);
          carry = (charIndex & mask) << shift;
        } else {
          carry += charIndex << shift;
        }
      }
      result += StringFromCharCode(carry);
    } catch (e) {
      if (e === PADDING) {
        if (allowConcatenation) {
          while (position < length && encodedString[position] === padding) {
            position++;
          }
          i = position;
          continue;
        }
        break;
      }
      throw e;
    }
  }
  return result;
}

const DecodeToBytes = (target, encodedString, ignorePadding, allowConcatenation) => {
  const length = encodedString.length;
  if (!length) {
    return new Uint8Array(0);
  }
  const baseMapLookup = GetSlot(target, $BaseMapLookup);
  const padding = GetSlot(target, $Padding) || '\0';
  const paddingCharCode = GetSlot(target, $PaddingCharCode) || 0;
  const capacity = GetInverseCapacity(length);
  const result = new Uint8Array(capacity);
  let index = 0;
  let position = 0;
  for (let i = 0; i < length; i += 4) {
    try {
      const bytes = GetDecodingBytes(length, position);
      let carry = 0;
      for (let j = 0; j < bytes; j++) {
        const charCode = StringCharCodeAt(encodedString, position++);
        const charIndex = MapGet(baseMapLookup, charCode);
        if (charIndex === undefined) {
          if (charCode === paddingCharCode && !ignorePadding) {
            throw PADDING;
          }
          throw new RangeError('Invalid Base64 encoding');
        }
        const mask = DECODING_MASKS[j];
        const shift = DECODING_SHIFTS[j];
        if (mask) {
          result[index++] = carry + (charIndex >> DECODING_DIGITS[j]);
          carry = (charIndex & mask) << shift;
        } else {
          carry += charIndex << shift;
        }
      }
      result[index++] = carry;
    } catch (e) {
      if (e === PADDING) {
        if (allowConcatenation) {
          while (position < length && encodedString[position] === padding) {
            position++;
          }
          i = position;
          continue;
        }
        break;
      }
      throw e;
    }
  }
  return capacity !== index ? TypedArraySlice(result, 0, index) : result;
}

const EncodeBytes = (target, buffer, withPadding) => {
  const source = IsUint8Array(buffer) ? buffer : new Uint8Array(buffer);
  const length = TypedArrayLength(source);
  if (!length) {
    return new Uint8Array(0);
  }
  const baseMap = GetSlot(target, $BaseMap);
  const capacity = GetCapacity(length, withPadding);
  const result = new Uint8Array(capacity);
  let index = 0;
  let position = 0;
  for (let i = 0; i < length; i += 3) {
    const bytes = GetEncodingBytes(length, i);
    let carry = 0;
    for (let j = 0; j < bytes; j++) {
      const byte = source[position++];
      const charIndex = carry + (byte >> ENCODING_SHIFTS[j]);
      result[index++] = MapGet(baseMap, charIndex);
      carry = (byte & ENCODING_MASKS[j]) << ENCODING_DIGITS[j];
    }
    result[index++] = MapGet(baseMap, carry);
  }
  if (withPadding && index < capacity) {
    const paddingCharCode = GetSlot(target, $PaddingCharCode);
    if (paddingCharCode) {
      while (index < capacity) {
        result[index++] = paddingCharCode;
      }
    }
  }
  return result;
}

const EncodeBytesToString = (target, buffer, withPadding) => {
  const source = IsUint8Array(buffer) ? buffer : new Uint8Array(buffer);
  const length = TypedArrayLength(source);
  if (!length) {
    return '';
  }
  const alphabet = GetSlot(target, $Alphabet);
  let result = '';
  let position = 0;
  for (let i = 0; i < length; i += 3) {
    const bytes = GetEncodingBytes(length, i);
    let carry = 0;
    for (let j = 0; j < bytes; j++) {
      const byte = source[position++];
      const charIndex = carry + (byte >> ENCODING_SHIFTS[j]);
      result += alphabet[charIndex];
      carry = (byte & ENCODING_MASKS[j]) << ENCODING_DIGITS[j];
    }
    result += alphabet[carry];
  }
  if (withPadding) {
    const paddedLength = GetPaddedLength(result.length);
    if (result.length < paddedLength) {
      const padding = GetSlot(target, $Padding) || '\0';
      while (result.length < paddedLength) {
        result += padding;
      }
    }
  }
  return result;
}

const DecodeBytes = (target, buffer, ignorePadding, allowConcatenation) => {
  const source = IsUint8Array(buffer) ? buffer : new Uint8Array(buffer);
  const length = TypedArrayLength(source);
  if (!length) {
    return new Uint8Array(0);
  }
  const baseMapLookup = GetSlot(target, $BaseMapLookup);
  const paddingCharCode = GetSlot(target, $PaddingCharCode) || 0;
  const capacity = GetInverseCapacity(length);
  const result = new Uint8Array(capacity);
  let index = 0;
  let position = 0;
  for (let i = 0; i < length; i += 4) {
    try {
      const bytes = GetDecodingBytes(length, position);
      let carry = 0;
      for (let j = 0; j < bytes; j++) {
        const charCode = source[position++];
        const charIndex = MapGet(baseMapLookup, charCode);
        if (charIndex === undefined) {
          if (charCode === paddingCharCode && !ignorePadding) {
            throw PADDING;
          }
          throw new RangeError('Invalid Base64 encoding');
        }
        const mask = DECODING_MASKS[j];
        const shift = DECODING_SHIFTS[j];
        if (mask) {
          result[index++] = carry + (charIndex >> DECODING_DIGITS[j]);
          carry = (charIndex & mask) << shift;
        } else {
          carry += charIndex << shift;
        }
      }
      result[index++] = carry;
    } catch (e) {
      if (e === PADDING) {
        if (allowConcatenation) {
          while (position < length && source[position] === paddingCharCode) {
            position++;
          }
          i = position;
          continue;
        }
        break;
      }
      throw e;
    }
  }
  return capacity !== index ? TypedArraySlice(result, 0, index) : result;
}

const DecodeBytesToString = (target, buffer, ignorePadding, allowConcatenation) => {
  const source = IsUint8Array(buffer) ? buffer : new Uint8Array(buffer);
  const length = TypedArrayLength(source);
  if (!length) {
    return '';
  }
  const baseMapLookup = GetSlot(target, $BaseMapLookup);
  const paddingCharCode = GetSlot(target, $PaddingCharCode) || 0;
  let result = '';
  let position = 0;
  for (let i = 0; i < length; i += 4) {
    try {
      const bytes = GetDecodingBytes(length, position);
      let carry = 0;
      for (let j = 0; j < bytes; j++) {
        const charCode = source[position++];
        const charIndex = MapGet(baseMapLookup, charCode);
        if (charIndex === undefined) {
          if (charCode === paddingCharCode && !ignorePadding) {
            throw PADDING;
          }
          throw new RangeError('Invalid Base64 encoding');
        }
        const mask = DECODING_MASKS[j];
        const shift = DECODING_SHIFTS[j];
        if (mask) {
          const charCode = carry + (charIndex >> DECODING_DIGITS[j]);
          result += StringFromCharCode(charCode);
          carry = (charIndex & mask) << shift;
        } else {
          carry += charIndex << shift;
        }
      }
      result += StringFromCharCode(carry);
    } catch (e) {
      if (e === PADDING) {
        if (allowConcatenation) {
          while (position < length && source[position] === paddingCharCode) {
            position++;
          }
          i = position;
          continue;
        }
        break;
      }
      throw e;
    }
  }
  return result;
}

const EncodeText = (target, text, withPadding) => {
  const buffer = UTF8Encode(text);
  return EncodeBytesToString(target, buffer, withPadding);
}

const EncodeTextToBytes = (target, text, withPadding) => {
  const buffer = UTF8Encode(text);
  return EncodeBytes(target, buffer, withPadding);
}

const DecodeText = (target, encodedString, ignorePadding, allowConcatenation) => {
  const buffer = DecodeToBytes(target, encodedString, ignorePadding, allowConcatenation);
  return UTF8Decode(buffer);
}

const DecodeBytesToText = (target, buffer, ignorePadding, allowConcatenation) => {
  const bytes = DecodeBytes(target, buffer, ignorePadding, allowConcatenation);
  return UTF8Decode(bytes);
}

const EncodeInt = (target, integer) => {
  const alphabet = GetSlot(target, $Alphabet);
  if (!integer) {
    return alphabet[0];
  }
  let result = '';
  let carry = integer;
  while (carry) {
    const charIndex = carry % 64;
    const char = alphabet[charIndex];
    result = `${char}${result}`;
    carry = MathFloor(carry / 64);
  }
  return result;
}

const DecodeInt = (target, encodedInteger) => {
  const length = encodedInteger.length;
  if (!length) {
    return NaN;
  }
  const alphabet = GetSlot(target, $Alphabet);
  const alphabetLookup = GetSlot(target, $AlphabetLookup);
  const zeroChar = alphabet[0];
  let leadingZeros = 0;
  while (leadingZeros < length && encodedInteger[leadingZeros] === zeroChar) {
    leadingZeros++;
  }
  let result = 0;
  for (let i = leadingZeros; i < length; i++) {
    const char = encodedInteger[i];
    const charIndex = MapGet(alphabetLookup, char);
    if (charIndex === undefined) {
      return NaN;
    }
    result = result * 64 + charIndex;
  }
  return result;
}

export class Base64Encoding {
  constructor(alphabet, options) {
    if (!IsString(alphabet)) {
      throw new TypeError('`alphabet` is not a string');
    }
    const length = alphabet.length;
    if (!length || length > 64) {
      throw new RangeError('Alphabet length out of range');
    }
    const alphabetLookup = new Map();
    const baseMap = new Map();
    const baseMapLookup = new Map();
    for (let i = 0; i < 64; i++) {
      const char = alphabet[i];
      if (MapHas(alphabetLookup, char)) {
        throw new RangeError('Invalid alphabet');
      }
      const charCode = StringCharCodeAt(alphabet, i);
      if (charCode < 0x21 || charCode > 0x7e) {
        throw new RangeError('Invalid alphabet');
      }
      MapSet(alphabetLookup, char, i);
      MapSet(baseMap, i, charCode);
      MapSet(baseMapLookup, charCode, i);
    }
    let padding;
    let paddingCharCode;
    if (options === undefined) {
      padding = DEFAULT_PADDING;
      paddingCharCode = DEFAULT_PADDING_CHAR_CODE;
    } else {
      RequireOptionsObject(options);
      const $padding = options.padding;
      if ($padding === undefined) {
        padding = DEFAULT_PADDING;
        paddingCharCode = DEFAULT_PADDING_CHAR_CODE;
      } else {
        padding = $padding;
        if (!IsString(padding)) {
          throw new TypeError('`options.padding` is not a string');
        }
        if (padding.length > 1) {
          throw new RangeError('Invalid padding');
        }
        if (padding) {
          paddingCharCode = StringCharCodeAt(padding);
          if (paddingCharCode < 0x21 || paddingCharCode > 0x7e) {
            throw new RangeError('Invalid padding');
          }
        }
      }
    }
    if (MapHas(alphabetLookup, padding)) {
      throw new RangeError('Invalid padding');
    }
    DefineSlots(this, {
      [$Alphabet]: alphabet,
      [$AlphabetLookup]: alphabetLookup,
      [$BaseMap]: baseMap,
      [$BaseMapLookup]: baseMapLookup,
      [$Padding]: padding,
      [$PaddingCharCode]: paddingCharCode
    });
  }

  get alphabet() {
    RequireThis(this);
    return GetSlot(this, $Alphabet);
  }

  get padding() {
    RequireThis(this);
    return GetSlot(this, $Padding);
  }

  encode(string, options) {
    RequireThis(this);
    const $string = ToString(string);
    let withPadding = !!GetSlot(this, $Padding);
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $withPadding = options.withPadding;
      if ($withPadding !== undefined) {
        withPadding = !!$withPadding;
      }
    }
    return Encode(this, $string, withPadding);
  }

  encodeToBytes(string, options) {
    RequireThis(this);
    const $string = ToString(string);
    let withPadding = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      withPadding = !!options.withPadding;
    }
    return EncodeToBytes(this, $string, withPadding);
  }

  decode(encodedString, options) {
    RequireThis(this);
    const $encodedString = ToString(encodedString);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return Decode(this, $encodedString, ignorePadding, allowConcatenation);
  }

  decodeToBytes(encodedString, options) {
    RequireThis(this);
    const $encodedString = ToString(encodedString);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return DecodeToBytes(this, $encodedString, ignorePadding, allowConcatenation);
  }

  encodeBytes(buffer, options) {
    RequireThis(this);
    RequireBuffer(buffer);
    let withPadding = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      withPadding = !!options.withPadding;
    }
    return EncodeBytes(this, buffer, withPadding);
  }

  encodeBytesToString(buffer, options) {
    RequireThis(this);
    RequireBuffer(buffer);
    let withPadding = !!GetSlot(this, $Padding);
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $withPadding = options.withPadding;
      if ($withPadding !== undefined) {
        withPadding = !!$withPadding;
      }
    }
    return EncodeBytesToString(this, buffer, withPadding);
  }

  decodeBytes(buffer, options) {
    RequireThis(this);
    RequireBuffer(buffer);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return DecodeBytes(this, buffer, ignorePadding, allowConcatenation);
  }

  decodeBytesToString(buffer, options) {
    RequireThis(this);
    RequireBuffer(buffer);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return DecodeBytesToString(this, buffer, ignorePadding, allowConcatenation);
  }

  encodeText(text, options) {
    RequireThis(this);
    const $text = ToString(text);
    let withPadding = !!GetSlot(this, $Padding);
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $withPadding = options.withPadding;
      if ($withPadding !== undefined) {
        withPadding = !!$withPadding;
      }
    }
    return EncodeText(this, $text, withPadding);
  }

  encodeTextToBytes(text, options) {
    RequireThis(this);
    const $text = ToString(text);
    let withPadding = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      withPadding = !!options.withPadding;
    }
    return EncodeTextToBytes(this, $text, withPadding);
  }

  decodeText(encodedString, options) {
    RequireThis(this);
    const $encodedString = ToString(encodedString);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return DecodeText(this, $encodedString, ignorePadding, allowConcatenation);
  }

  decodeBytesToText(buffer, options) {
    RequireThis(this);
    RequireBuffer(buffer);
    let ignorePadding = !GetSlot(this, $Padding);
    let allowConcatenation = false;
    if (options !== undefined) {
      RequireOptionsObject(options);
      const $ignorePadding = options.ignorePadding;
      if ($ignorePadding !== undefined) {
        ignorePadding = !!$ignorePadding;
      }
      allowConcatenation = !!options.allowConcatenation;
    }
    return DecodeBytesToText(this, buffer, ignorePadding, allowConcatenation);
  }

  encodeInt(integer) {
    RequireThis(this);
    const $integer = ToIntegerOrInfinity(integer);
    if ($integer < 0) {
      throw new RangeError('`integer` cannot be negative');
    }
    if ($integer === Infinity) {
      throw new RangeError('`integer` is not finite');
    }
    return EncodeInt(this, $integer);
  }

  decodeInt(encodedInteger) {
    RequireThis(this);
    const $encodedInteger = ToString(encodedInteger);
    return DecodeInt(this, $encodedInteger);
  }
}
export default Base64Encoding;

ReflectDefineProperty(Base64Encoding, SymbolHasInstance, {
  value: IsBase64Encoding
});

const Base64EncodingPrototype = Base64Encoding.prototype;

ReflectDefineProperty(Base64EncodingPrototype, SymbolToStringTag, {
  value: 'Base64Encoding'
});

if (BigInt) {
  const BIGINT_ZERO = BigInt(0);
  const BIGINT_BASE = BigInt(64);

  const EncodeBigInt = (target, bigint) => {
    const alphabet = GetSlot(target, $Alphabet);
    if (!bigint) {
      return alphabet[0];
    }
    let result = '';
    let carry = bigint;
    while (carry) {
      const charIndex = carry % BIGINT_BASE;
      const char = alphabet[charIndex];
      result = `${char}${result}`;
      carry /= BIGINT_BASE;
    }
    return result;
  }

  const DecodeBigInt = (target, encodedInteger) => {
    const length = encodedInteger.length;
    if (!length) {
      throw new RangeError('Invalid Base64 encoded integer');
    }
    const alphabet = GetSlot(target, $Alphabet);
    const alphabetLookup = GetSlot(target, $AlphabetLookup);
    const zeroChar = alphabet[0];
    let leadingZeros = 0;
    while (leadingZeros < length && encodedInteger[leadingZeros] === zeroChar) {
      leadingZeros++;
    }
    let result = BIGINT_ZERO;
    for (let i = leadingZeros; i < length; i++) {
      const char = encodedInteger[i];
      const charIndex = MapGet(alphabetLookup, char);
      if (charIndex === undefined) {
        throw new RangeError('Invalid Base64 encoded integer');
      }
      result = result * BIGINT_BASE + BigInt(charIndex);
    }
    return result;
  }

  ObjectDefineProperties(Base64EncodingPrototype, {
    encodeBigInt: {
      value: function encodeBigInt(bigint) {
        RequireThis(this);
        const $bigint = ToBigInt(bigint);
        if ($bigint < BIGINT_ZERO) {
          throw new RangeError('`bigint` cannot be negative');
        }
        return EncodeBigInt(this, $bigint);
      }
    },
    decodeBigInt: {
      value: function decodeBigInt(encodedInteger) {
        RequireThis(this);
        const $encodedInteger = ToString(encodedInteger);
        return DecodeBigInt(this, $encodedInteger);
      }
    }
  });
}

export const BASIC = new Base64Encoding('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
export const URL = new Base64Encoding('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', {
  padding: ''
});

ObjectDefineProperties(Base64Encoding, {
  BASIC: {
    value: BASIC
  },
  URL: {
    value: URL
  }
});
