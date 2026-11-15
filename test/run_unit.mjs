// 職責單一：純邏輯單元測試（unit_slot_logic.mjs、unit_approval_match.mjs、unit_approval_pdf.mjs、unit_auto_lock_time.mjs）的執行入口（把 --experimental-loader 換成官方建議的
// register() 寫法，避免每次跑都印一段 ExperimentalWarning）。
// 執行：node test/run_unit.mjs（或雙擊 run_unit.bat）
import { register } from 'node:module'

register(new URL('./esm-js-ext-loader.mjs', import.meta.url))
await import('./unit_slot_logic.mjs')
console.log('')
await import('./unit_approval_match.mjs')
console.log('')
await import('./unit_approval_pdf.mjs')
console.log('')
await import('./unit_auto_lock_time.mjs')
