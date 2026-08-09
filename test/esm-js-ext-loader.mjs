// 職責單一：讓 unit_slot_logic.mjs 能用純 Node（不裝 bundler）import 專案原始碼。
// 專案原始碼是寫給 Vite 用的，relative import 不帶副檔名（例如 './carrangeHelpers'）；
// Node 原生 ESM resolver 要求副檔名，這支 loader 補上「解析失敗就試著加 .js 副檔名再試一次」。
// 用法：node --experimental-loader ./test/esm-js-ext-loader.mjs test/unit_slot_logic.mjs
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + '.js', context)
    }
    throw err
  }
}
