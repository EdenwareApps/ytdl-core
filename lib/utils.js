const { request } = require("undici");
const miniget = require('miniget');

/**
 * Extrai uma string que está entre duas outras.
 *
 * @param {string} haystack
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
const between = (exports.between = (haystack, left, right) => {
  let pos;
  if (left instanceof RegExp) {
    const match = haystack.match(left);
    if (!match) {
      return "";
    }
    pos = match.index + match[0].length;
  } else {
    pos = haystack.indexOf(left);
    if (pos === -1) {
      return "";
    }
    pos += left.length;
  }
  haystack = haystack.slice(pos);
  pos = haystack.indexOf(right);
  if (pos === -1) {
    return "";
  }
  haystack = haystack.slice(0, pos);
  return haystack;
});

exports.tryParseBetween = (body, left, right, prepend = "", append = "") => {
  try {
    let data = between(body, left, right);
    if (!data) return null;
    return JSON.parse(`${prepend}${data}${append}`);
  } catch (e) {
    return null;
  }
};

/**
 * Converte string numérica abreviada em número.
 *
 * @param {string} string
 * @returns {number}
 */
exports.parseAbbreviatedNumber = string => {
  const match = string
    .replace(",", ".")
    .replace(" ", "")
    .match(/([\d,.]+)([MK]?)/);
  if (match) {
    let [, num, multi] = match;
    num = parseFloat(num);
    return Math.round(multi === "M" ? num * 1000000 : multi === "K" ? num * 1000 : num);
  }
  return null;
};

/**
 * Escape sequences para cutAfterJS.
 * @param {string} start string de início da sequência
 * @param {string} end string que finaliza a sequência
 * @param {undefined|Regex} startPrefix regex para verificar os 10 caracteres anteriores
 */
const ESCAPING_SEQUENZES = [
  // Strings
  { start: '"', end: '"' },
  { start: "'", end: "'" },
  { start: "`", end: "`" },
  // Expressão regular
  { start: "/", end: "/", startPrefix: /(^|[[{:;,/])\s?$/ },
];

/**
 * Recorta o trecho JS delimitado por chaves (ou colchetes) e retorna somente o JSON.
 *
 * @param {string} mixedJson
 * @returns {string}
 */
exports.cutAfterJS = mixedJson => {
  let open, close;
  if (mixedJson[0] === "[") {
    open = "[";
    close = "]";
  } else if (mixedJson[0] === "{") {
    open = "{";
    close = "}";
  }

  if (!open) {
    throw new Error(`JSON não suportado (precisa começar com [ ou { ) mas recebeu: ${mixedJson[0]}`);
  }

  let isEscapedObject = null;
  let isEscaped = false;
  let counter = 0;
  let i;

  for (i = 0; i < mixedJson.length; i++) {
    if (!isEscaped && isEscapedObject !== null && mixedJson[i] === isEscapedObject.end) {
      isEscapedObject = null;
      continue;
    } else if (!isEscaped && isEscapedObject === null) {
      for (const escaped of ESCAPING_SEQUENZES) {
        if (mixedJson[i] !== escaped.start) continue;
        if (!escaped.startPrefix || mixedJson.substring(i - 10, i).match(escaped.startPrefix)) {
          isEscapedObject = escaped;
          break;
        }
      }
      if (isEscapedObject !== null) {
        continue;
      }
    }

    isEscaped = mixedJson[i] === "\\" && !isEscaped;

    if (isEscapedObject !== null) continue;

    if (mixedJson[i] === open) {
      counter++;
    } else if (mixedJson[i] === close) {
      counter--;
    }

    if (counter === 0) {
      return mixedJson.substring(0, i + 1);
    }
  }

  throw Error("JSON não suportado (chave de fechamento não encontrada)");
};

class UnrecoverableError extends Error {}
/**
 * Verifica se há erro de playabilidade.
 *
 * @param {Object} player_response
 * @returns {!Error}
 */
exports.playError = player_response => {
  const playability = player_response?.playabilityStatus;
  if (!playability) return null;
  if (["ERROR", "LOGIN_REQUIRED"].includes(playability.status)) {
    return new UnrecoverableError(playability.reason || playability.messages?.[0]);
  }
  if (playability.status === "LIVE_STREAM_OFFLINE") {
    return new UnrecoverableError(playability.reason || "A live stream está offline.");
  }
  if (playability.status === "UNPLAYABLE") {
    return new UnrecoverableError(playability.reason || "Esse vídeo não está disponível.");
  }
  return null;
};

// Função auxiliar para requisições usando Undici (ou fetch, se fornecido)
const useFetch = async (fetch, url, requestOptions) => {
  const query = requestOptions.query;
  if (query) {
    const urlObject = new URL(url);
    for (const key in query) {
      urlObject.searchParams.append(key, query[key]);
    }
    url = urlObject.toString();
  }

  const response = await fetch(url, requestOptions);
  const statusCode = response.status;
  const body = Object.assign(response, response.body || {});
  const headers = Object.fromEntries(response.headers.entries());

  return { body, statusCode, headers };
};

exports.request = async (url, options = {}) => {
  let { requestOptions, rewriteRequest, fetch } = options;

  if (typeof rewriteRequest === "function") {
    const rewritten = rewriteRequest(url, requestOptions);
    requestOptions = rewritten.requestOptions || requestOptions;
    url = rewritten.url || url;
  }

  const req =
    typeof fetch === "function"
      ? await useFetch(fetch, url, requestOptions)
      : await request(url, requestOptions);
  const code = req.statusCode.toString();

  if (code.startsWith("2")) {
    if (req.headers["content-type"].includes("application/json")) return req.body.json();
    return req.body.text();
  }
  if (code.startsWith("3")) return exports.request(req.headers.location, options);

  const e = new Error(`Status code: ${code}`);
  e.statusCode = req.statusCode;
  throw e;
};

/**
 * Função temporária para depreciação de algumas propriedades.
 *
 * @param {Object} obj
 * @param {string} prop
 * @param {Object} value
 * @param {string} oldPath
 * @param {string} newPath
 */
exports.deprecate = (obj, prop, value, oldPath, newPath) => {
  Object.defineProperty(obj, prop, {
    get: () => {
      console.warn(`\`${oldPath}\` será removido em breve, use \`${newPath}\` em seu lugar.`);
      return value;
    },
  });
};

// Checa por atualizações.
const pkg = require("../package.json");
const UPDATE_INTERVAL = 1000 * 60 * 60 * 12;
let updateWarnTimes = 0;
exports.lastUpdateCheck = 0;

/**
 * Gera um endereço IPv6 aleatório a partir de um bloco em CIDR.
 *
 * @param {string} ip bloco IPv6 no formato CIDR
 * @returns {string}
 */
const getRandomIPv6 = ip => {
  if (!isIPv6(ip)) {
    throw new Error("Formato IPv6 inválido");
  }

  const [rawAddr, rawMask] = ip.split("/");
  const mask = parseInt(rawMask, 10);

  if (isNaN(mask) || mask > 128 || mask < 1) {
    throw new Error("Máscara de sub-rede IPv6 inválida (deve estar entre 1 e 128)");
  }

  const base10addr = normalizeIP(rawAddr);

  const fullMaskGroups = Math.floor(mask / 16);
  const remainingBits = mask % 16;

  const result = new Array(8).fill(0);

  for (let i = 0; i < 8; i++) {
    if (i < fullMaskGroups) {
      result[i] = base10addr[i];
    } else if (i === fullMaskGroups && remainingBits > 0) {
      const groupMask = 0xffff << (16 - remainingBits);
      const randomPart = Math.floor(Math.random() * (1 << (16 - remainingBits)));
      result[i] = (base10addr[i] & groupMask) | randomPart;
    } else {
      result[i] = Math.floor(Math.random() * 0x10000);
    }
  }

  return result.map(x => x.toString(16).padStart(4, "0")).join(":");
};

const isIPv6 = ip => {
  const IPV6_REGEX =
    /^(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,7}:)|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?:(?::[0-9a-fA-F]{1,4}){1,6})|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(?:ffff(?::0{1,4}){0,1}:){0,1}(?:(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])\.){3}(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])|(?:[0-9a-fA-F]{1,4}:){1,4}:(?:(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9])\.){3}(?:25[0-5]|(?:2[0-4]|1?[0-9])?[0-9]))(?:\/(?:1[0-1][0-9]|12[0-8]|[1-9][0-9]|[1-9]))?$/;
  return IPV6_REGEX.test(ip);
};

/**
 * Normaliza um endereço IPv6 para um array de 8 números.
 *
 * @param {string} ip - Endereço IPv6
 * @returns {number[]} - Array com 8 números representando o endereço
 */
const normalizeIP = ip => {
  const parts = ip.split("::");
  let start = parts[0] ? parts[0].split(":") : [];
  let end = parts[1] ? parts[1].split(":") : [];

  const missing = 8 - (start.length + end.length);
  const zeros = new Array(missing).fill("0");

  const full = [...start, ...zeros, ...end];

  return full.map(part => parseInt(part || "0", 16));
};

exports.saveDebugFile = (name, body) => {
  const filename = `${+new Date()}-${name}`;
  writeFileSync(filename, body);
  return filename;
};

const findPropKeyInsensitive = (obj, prop) =>
  Object.keys(obj).find(p => p.toLowerCase() === prop.toLowerCase()) || null;

exports.getPropInsensitive = (obj, prop) => {
  const key = findPropKeyInsensitive(obj, prop);
  return key && obj[key];
};

exports.setPropInsensitive = (obj, prop, value) => {
  const key = findPropKeyInsensitive(obj, prop);
  obj[key || prop] = value;
  return key;
};

// As funções abaixo foram adaptadas para remover a dependência de agent.js.
// Agora elas não realizam nenhuma operação e servem apenas como _placeholders_.

exports.applyDefaultAgent = options => {
  // Sem suporte a agent; nenhuma modificação é realizada.
};

exports.applyOldLocalAddress = options => {
  // Sem suporte a agent; nenhuma modificação é realizada.
};

exports.applyIPv6Rotations = options => {
  // Opção IPv6Block depreciada; nenhuma modificação é realizada.
};

exports.applyDefaultHeaders = options => {
  options.requestOptions = Object.assign({}, options.requestOptions);
  options.requestOptions.headers = Object.assign(
    {},
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Safari/537.36",
    },
    options.requestOptions.headers
  );
};

exports.generateClientPlaybackNonce = length => {
  const CPN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length }, () => CPN_CHARS[Math.floor(Math.random() * CPN_CHARS.length)]).join("");
};

exports.applyPlayerClients = options => {
  if (!options.playerClients || options.playerClients.length === 0) {
    options.playerClients = ["WEB_EMBEDDED", "IOS", "ANDROID", "TV"];
  }
};

exports.exposedMiniget = miniget;