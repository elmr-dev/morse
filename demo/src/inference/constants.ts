// CWNet streaming + CTC constants (mirror of model/cwnet.py + eval/decode.py)

export const BLANK_IDX = 0
export const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?=/'
export const NUM_CLASSES = CHARS.length + 1 // 42

export const IDX_TO_CHAR: Record<number, string> = { 0: '' }
CHARS.split('').forEach((c, i) => { IDX_TO_CHAR[i + 1] = c })

export const IN_CHANNELS = 3
export const ENVELOPE_SR = 500
export const CNN_STRIDE = 2
export const OUTPUT_SR = ENVELOPE_SR / CNN_STRIDE // 250 Hz

export const CHUNK_FRAMES = 100          // 200 ms of input (at 500 Hz)
export const LOOKAHEAD_FRAMES = 50       // 100 ms right context
export const CHUNK_INPUT = CHUNK_FRAMES + LOOKAHEAD_FRAMES  // 150
export const CHUNK_OUTPUT = CHUNK_FRAMES / CNN_STRIDE       // 50

export const GRU_LAYERS = 2
export const GRU_HIDDEN = 128

export const LOG_NUM_CLASSES = Math.log(NUM_CLASSES)
