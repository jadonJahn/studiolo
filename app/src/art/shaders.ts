import type { EngineFactory } from './engine';
import { hexToRgb } from './palettes';

const COMMON = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_progress;
uniform float u_energy;
uniform float u_seed;
uniform vec3 u_pal[5];
uniform vec3 u_bg;
uniform float u_bass, u_mid, u_treble, u_level, u_beat; // music, 0..~1.5 (0 when off)
out vec4 outColor;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// Integer lattice hash. The float hash above is fine for one-off lookups, but on
// noise lattices the shader compiler may reassociate (i+1)*k as i*k+k, so cells on
// either side of a lattice line disagree; contours then flicker along straight lines.
float ihash(ivec2 c){
  uvec2 q = uvec2(c);
  uint h = (q.x * 1597334673u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16u)) * 2246822519u;
  h ^= h >> 13u;
  return float(h) * (1.0 / 4294967295.0);
}
float noise(vec2 p){
  vec2 fl = floor(p), f = p - fl;
  ivec2 i = ivec2(fl);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(ihash(i), ihash(i + ivec2(1, 0)), u.x), mix(ihash(i + ivec2(0, 1)), ihash(i + ivec2(1, 1)), u.x), u.y);
}
// One layer of stars: each lattice cell may hold one star at a random spot inside it,
// so the field reads as scattered rather than gridded. Neighbours are checked so soft
// stars aren't clipped at cell edges.
float starLayer(vec2 p, float cells, float prob, int salt){
  vec2 g = p * cells;
  vec2 fl = floor(g), f = g - fl;
  ivec2 c = ivec2(fl) + ivec2(salt, salt * 7);
  float px = u_res.y / cells; // render pixels per cell
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    ivec2 cc = c + ivec2(x, y);
    if (ihash(cc) > prob) continue;
    vec2 pos = vec2(ihash(cc + ivec2(17, 3)), ihash(cc + ivec2(5, 29)));
    vec2 d = (vec2(float(x), float(y)) + pos - f) * px;
    float size = mix(0.5, 1.7, pow(ihash(cc + ivec2(41, 7)), 4.0)) * (1.0 + 0.5 * u_level);
    float tw = 0.65 + 0.35 * sin(u_time * (0.6 + 2.2 * ihash(cc + ivec2(9, 99))) + 40.0 * ihash(cc + ivec2(3, 3)));
    float b = mix(0.25, 1.0, pow(ihash(cc + ivec2(77, 13)), 2.0));
    acc += b * tw * exp(-dot(d, d) / (size * size));
  }
  return acc;
}

/** Two depth layers; music brightens and swells them (highs and beats). */
float stars(vec2 fc, float prob){
  vec2 p = fc / u_res.y + u_seed;
  float s = starLayer(p, 55.0, prob, 0) + 0.55 * starLayer(p, 130.0, prob * 0.6, 1013);
  return s * (1.0 + 1.4 * u_treble + 0.9 * u_beat);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++){ v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
vec3 pal(float t){
  t = clamp(t, 0.0, 1.0) * 4.0;
  int i = int(min(floor(t), 3.0));
  return mix(u_pal[i], u_pal[i+1], t - float(i));
}
vec3 palLoop(float t){
  t = fract(t) * 5.0;
  int i = int(floor(t));
  int j = i == 4 ? 0 : i + 1;
  return mix(u_pal[i], u_pal[j], t - float(i));
}
`;

const NEBULA = COMMON + /* glsl */ `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.08;
  vec2 p = uv * 1.5 + u_seed;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.5*q + vec2(1.7, 9.2) + 0.45*t), fbm(p + 3.5*q + vec2(8.3, 2.8) - 0.38*t));
  float f = fbm(p + 3.0 * r);
  vec3 col = mix(u_bg, pal(f * 1.1), smoothstep(0.3, 1.0, f));
  col = mix(col, pal(clamp(length(q) * 0.75, 0.0, 1.0)), 0.3 * dot(r, r));
  col += pal(clamp(r.x + 0.2, 0.0, 1.0)) * pow(f, 5.0) * (0.4 + 1.4 * u_progress);
  col += stars(gl_FragCoord.xy, 0.16 + 0.14 * u_progress) * vec3(0.9, 0.92, 1.0);
  col *= 1.0 - 0.5 * dot(uv, uv);
  col = mix(u_bg, col, 0.5 + 0.5 * u_energy);
  outColor = vec4(col, 1.0);
}`;

const TOPOGRAPHY = COMMON + /* glsl */ `
uniform float u_calib;
uniform float u_q[17]; // height quantiles 0%, 6.25%, ... 100% measured on this piece

// Fraction of the map lower than h, by piecewise-linear lookup in the quantile table.
float heightRank(float h){
  if (h <= u_q[0]) return 0.0;
  for (int i = 0; i < 16; i++){
    if (h <= u_q[i + 1]) return (float(i) + (h - u_q[i]) / max(u_q[i + 1] - u_q[i], 1e-5)) / 16.0;
  }
  return 1.0;
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.04;
  vec2 q = p * 1.8 + u_seed;
  vec2 w = vec2(fbm(q + vec2(t, 0.0)), fbm(q + vec2(4.3, -t)));
  float h = fbm(q + 0.8 * w);
  if (u_calib > 0.5){ outColor = vec4(h, h, h, 1.0); return; }
  float hn = clamp((h - 0.18) / 0.64, 0.0, 1.0);
  float inRange = step(0.001, hn) * step(hn, 0.999);
  float x = hn * 26.0;
  float fw = fwidth(x) + 1e-4;
  float line = 1.0 - smoothstep(0.0, 1.3 * fw, abs(fract(x + 0.5) - 0.5));
  float x5 = x / 5.0;
  float fw5 = fwidth(x5) + 1e-4;
  float major = 1.0 - smoothstep(0.0, 1.8 * fw5, abs(fract(x5 + 0.5) - 0.5));
  float pr = u_progress * 1.02;
  // Reveal lowest ground first, by measured rank, so revealed area tracks progress.
  float rank = heightRank(h);
  float revealed = 1.0 - smoothstep(pr - 0.02, pr + 0.01, rank);
  vec3 c = pal(hn);
  vec3 col = u_bg + c * 0.08 * revealed;
  col += c * (line * 0.5 + major * 0.55) * inRange * mix(0.22, 1.0, revealed);
  float front = exp(-abs(rank - pr) * 60.0) * step(0.002, u_progress) * step(u_progress, 0.998);
  col += c * front * (line + major) * (0.6 + 0.25 * sin(u_time * 2.0));
  col *= (1.0 - 0.4 * dot(p, p)) * (1.0 + 0.7 * u_level);
  col = mix(u_bg, col, 0.6 + 0.4 * u_energy);
  outColor = vec4(col, 1.0);
}`;

const AURORA = COMMON + /* glsl */ `
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time;
  vec3 col = mix(u_bg * 1.8 + 0.01, u_bg * 0.6, uv.y);
  col += stars(gl_FragCoord.xy, 0.22) * vec3(0.9) * smoothstep(-0.15, 0.4, p.y);
  float reach = max(1.8, mix(11.0, 3.2, u_progress) - 3.0 * u_bass);
  for (int i = 0; i < 5; i++){
    float fi = float(i);
    float x = p.x * (0.8 + fi * 0.25) + fi * 3.7 + u_seed;
    float base = -0.14 + fi * 0.07 + 0.24 * (fbm(vec2(x * 0.7, t * 0.12 + fi)) - 0.5) + 0.05 * sin(x * 2.3 + t * 0.5 + fi);
    float d = p.y - base;
    float hgt = max(d, 0.0);
    float edge = smoothstep(-0.012, 0.01, d);
    float fall = exp(-hgt * reach);
    float streak = 0.4 + 0.6 * noise(vec2(x * 28.0, t * 0.7 + fi * 13.0));
    vec3 c = palLoop(fi * 0.21 + hgt * 1.1 + 0.05 * sin(t * 0.1));
    col += c * edge * (fall * streak * 0.45 * (1.0 + 1.2 * u_mid) + exp(-abs(d) * 55.0) * (0.3 + 0.6 * u_beat)) * (0.5 + 0.5 * u_energy);
  }
  float m1 = -0.30 + 0.12 * fbm(vec2(p.x * 1.4 + u_seed, 1.0));
  float m2 = -0.37 + 0.08 * fbm(vec2(p.x * 3.1 + u_seed * 2.0, 5.0));
  col = mix(col, u_bg * 0.55 + col * 0.12, smoothstep(0.003, -0.003, p.y - m1));
  col = mix(col, u_bg * 0.25, smoothstep(0.003, -0.003, p.y - m2));
  col *= 1.0 - 0.3 * dot(p, p);
  outColor = vec4(col, 1.0);
}`;

const GLASS = COMMON + /* glsl */ `
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  vec2 g = p * 6.0 + u_seed;
  vec2 flg = floor(g), fp = g - flg;
  ivec2 ip = ivec2(flg);
  float d1 = 8.0, d2 = 8.0;
  ivec2 cid = ivec2(0);
  float spd = u_time * 0.25;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    ivec2 cell = ip + ivec2(x, y);
    vec2 hh = vec2(ihash(cell), ihash(cell + ivec2(7919, 104729)));
    vec2 pt = o + 0.5 + 0.38 * sin(spd + 6.2831 * hh);
    float d = length(pt - fp);
    if (d < d1){ d2 = d1; d1 = d; cid = cell; } else if (d < d2){ d2 = d; }
  }
  float edge = d2 - d1;
  float r = ihash(cid + ivec2(131, 977));
  float filled = 1.0 - smoothstep(u_progress * 1.04 - 0.03, u_progress * 1.04, r);
  vec3 c = palLoop(ihash(cid + ivec2(33, 3301)));
  float light = 0.55 + 0.45 * sin(dot(vec2(cid), vec2(0.7, 1.3)) + u_time * 0.4) + 0.5 * u_treble * ihash(cid + ivec2(int(u_time * 6.0), 0));
  vec3 glass = c * (0.35 + 0.5 * light) * (1.0 - 0.45 * smoothstep(0.0, 0.7, d1));
  glass *= 0.85 + 0.3 * noise(g * 9.0);
  vec3 col = u_bg;
  col = mix(col, glass, filled * 0.95);
  float lead = smoothstep(0.07, 0.03, edge);
  col = mix(col, vec3(0.012), lead * filled);
  col += c * 0.3 * smoothstep(0.05, 0.0, edge) * (1.0 - filled);
  col += glass * (0.45 + 0.6 * u_beat) * filled * exp(-d1 * 4.0);
  col *= 1.0 - 0.35 * dot(p, p);
  col = mix(u_bg, col, 0.55 + 0.45 * u_energy);
  outColor = vec4(col, 1.0);
}`;

const VISUALIZER = COMMON + /* glsl */ `
uniform float u_spec[48];

float spec(float x){
  x = clamp(x, 0.0, 1.0) * 47.0;
  int i = int(floor(x));
  int j = min(i + 1, 47);
  return mix(u_spec[i], u_spec[j], x - float(i));
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float r = length(p);
  // Mirrored around the vertical axis: bass at the top, treble at the bottom.
  float a = atan(p.x, p.y);
  float x = abs(a) / 3.14159265;
  float s = spec(x);
  // Idle breathing when nothing is playing.
  float idle = (1.0 - smoothstep(0.0, 0.05, u_level)) * (0.06 + 0.04 * sin(x * 18.0 + u_time * 1.3));
  s = max(s, idle);

  vec3 col = u_bg;
  // Faint nebula backdrop that swells with the bass.
  float n = fbm(p * 1.6 + u_seed + vec2(u_time * 0.03, -u_time * 0.02));
  col += pal(n) * 0.1 * (0.6 + u_bass);

  float base = 0.33 + 0.02 * u_bass + 0.015 * u_beat;
  float outer = base + 0.17 * s;
  vec3 c = palLoop(x * 0.85 + u_time * 0.015);
  float body = smoothstep(outer + 0.002, outer - 0.004, r) * smoothstep(base - 0.004, base + 0.002, r);
  // Thin radial bars: 96 around the circle.
  float bars = smoothstep(0.42, 0.3, abs(fract(x * 48.0) - 0.5));
  col += c * body * mix(0.35, 1.0, bars) * (0.45 + 0.75 * s);
  col += c * exp(-abs(r - outer) * 110.0) * (0.5 + 0.8 * s);
  col += c * exp(-abs(r - base) * 160.0) * 0.35;

  // Echo ripples travelling outward, louder with the music.
  float ripple = pow(0.5 + 0.5 * sin((r - u_time * 0.12) * 48.0), 24.0);
  col += c * ripple * smoothstep(base, base + 0.4, r) * (0.03 + 0.12 * u_level);

  // Session progress as an arc around the ring (clockwise from the top).
  float ang = fract(atan(p.x, p.y) / 6.2831853);
  float arcR = base + 0.23;
  float onArc = exp(-abs(r - arcR) * 380.0);
  col += pal(0.9) * onArc * (ang < u_progress ? 0.75 : 0.1);

  col += c * u_beat * 0.08 * smoothstep(base, 0.0, r);
  col *= 1.0 - 0.35 * dot(p, p);
  col = mix(u_bg, col, 0.6 + 0.4 * u_energy);
  outColor = vec4(col, 1.0);
}`;

const VERT = `#version 300 es
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return sh;
}

/**
 * calibrate: the shader outputs its raw field value when u_calib = 1. We render that
 * once at low resolution, read it back, and pass the quantiles as u_q so a reveal
 * can be driven by area rather than by raw value (fbm is far from uniform).
 */
function shaderEngine(frag: string, renderScale: number, calibrate = false): EngineFactory {
  return (canvas, seed, palette) => {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Link failed: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u('u_res');
    const uTime = u('u_time');
    const uProg = u('u_progress');
    const uEnergy = u('u_energy');
    const uBass = u('u_bass');
    const uMid = u('u_mid');
    const uTreble = u('u_treble');
    const uLevel = u('u_level');
    const uBeat = u('u_beat');
    const uSpec = u('u_spec');
    const pal = palette.colors.flatMap((c) => hexToRgb(c).map((v) => v / 255));
    gl.uniform3fv(u('u_pal'), new Float32Array(pal));
    gl.uniform3fv(u('u_bg'), new Float32Array(hexToRgb(palette.bg).map((v) => v / 255)));
    gl.uniform1f(u('u_seed'), (seed % 997) / 9.7);

    const runCalibration = (aspect: number) => {
      const cw = 128;
      const ch = Math.max(16, Math.round(cw / aspect));
      gl.viewport(0, 0, cw, ch);
      gl.uniform2f(uRes, cw, ch);
      gl.uniform1f(u('u_calib'), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.uniform1f(u('u_calib'), 0);
      const vals = new Float32Array(cw * ch);
      for (let i = 0; i < vals.length; i++) vals[i] = px[i * 4] / 255;
      vals.sort();
      const q = new Float32Array(17);
      for (let i = 0; i <= 16; i++) q[i] = vals[Math.min(vals.length - 1, Math.round((i / 16) * (vals.length - 1)))];
      q[0] -= 0.01;
      q[16] += 0.01;
      gl.uniform1fv(u('u_q'), q);
    };

    let quality = 1;
    let last: [number, number, number] = [1, 1, 1];
    let calibratedAspect = 0;
    return {
      resize(w, h, dpr) {
        last = [w, h, dpr];
        const aspect = w / Math.max(1, h);
        if (calibrate && Math.abs(aspect - calibratedAspect) > 0.01) {
          runCalibration(aspect);
          calibratedAspect = aspect;
        }
        const s = Math.min(dpr, 2) * renderScale * quality;
        canvas.width = Math.max(1, Math.round(w * s));
        canvas.height = Math.max(1, Math.round(h * s));
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
      },
      frame(_dt, t, { progress, energy, audio }) {
        gl.uniform1f(uTime, t);
        gl.uniform1f(uProg, progress);
        gl.uniform1f(uEnergy, energy);
        gl.uniform1f(uBass, audio.bass);
        gl.uniform1f(uMid, audio.mid);
        gl.uniform1f(uTreble, audio.treble);
        gl.uniform1f(uLevel, audio.level);
        gl.uniform1f(uBeat, audio.beat);
        if (uSpec) gl.uniform1fv(uSpec, audio.bands);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      setQuality(q) {
        quality = q;
        this.resize(...last);
      },
      destroy() {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
      },
    };
  };
}

export const nebula = shaderEngine(NEBULA, 0.5);
export const topography = shaderEngine(TOPOGRAPHY, 0.8, true);
export const aurora = shaderEngine(AURORA, 0.6);
export const glass = shaderEngine(GLASS, 0.75);
export const visualizer = shaderEngine(VISUALIZER, 0.75);
