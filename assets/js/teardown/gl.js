// WebGL2 helpers of the teardown view: programs, textures, the off-screen target, the camera matrices.

export function program(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace('[0]', '');
    u[name] = gl.getUniformLocation(p, name);
  }
  return { p, u };
}

function params(gl, filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** An image file as an RGB8 texture, values untouched (no colour conversion, no premultiplication). */
export async function imageTexture(gl, url, linear = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, bmp);
  bmp.close();
  params(gl, linear ? gl.LINEAR : gl.NEAREST);
  return t;
}

/** A one-row RGBA32F lookup table (one texel per instance id). */
export function tableTexture(gl, data, width) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, 1, 0, gl.RGBA, gl.FLOAT, data);
  params(gl, gl.NEAREST);
  return t;
}

/** Off-screen target with a colour, an instance-id and a depth attachment; rebuilt when the size changes. */
export function target(gl, old, w, h) {
  if (old && old.w === w && old.h === h) return old;
  if (old) { gl.deleteFramebuffer(old.f); gl.deleteTexture(old.c); gl.deleteTexture(old.i); gl.deleteTexture(old.d); }
  const make = (format) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    params(gl, gl.NEAREST);
    return t;
  };
  const c = make(gl.RGBA8), i = make(gl.RGBA8), d = make(gl.DEPTH_COMPONENT24);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, c, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, i, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, d, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { f, c, i, d, w, h };
}

/** 4x4 product a*b, column-major. */
export function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = v;
  }
  return o;
}

/**
 * The scanner as a camera, turned about the centre of the scene.
 * At tilt = az = 0 and zoom = 1 a point lands exactly on its pixel of the scanner picture, which fills the
 * rectangle [-sx, sx] x [-sy, sy] of the canvas. Camera frame: x right, y down, z forward (millimetres).
 */
export function camera({ intr, crop, size, centre, sx, sy, zoom, tilt, az, near, far }) {
  const [fx, fy, cx, cy] = intr, [pw, ph] = size, kx = sx * zoom, ky = sy * zoom;
  const A = (far + near) / (far - near), B = -2 * far * near / (far - near);
  const proj = new Float32Array([
    kx * 2 * fx / pw, 0, 0, 0,
    0, -ky * 2 * fy / ph, 0, 0,
    kx * (2 * (cx - crop[0]) / pw - 1), ky * (1 - 2 * (cy - crop[1]) / ph), A, 1,
    0, 0, B, 0,
  ]);
  const th = tilt * Math.PI / 180, ph_ = az * Math.PI / 180;
  const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph_), sp = Math.sin(ph_);
  // R = Rx(-tilt) * Rz(az): turn about the scanner's axis, then look from the lower edge of the picture
  const R = [cp, -sp, 0, ct * sp, ct * cp, st, -st * sp, -st * cp, ct];           // row-major 3x3
  const [X, Y, Z] = centre;
  const t = [X - (R[0] * X + R[1] * Y + R[2] * Z), Y - (R[3] * X + R[4] * Y + R[5] * Z), Z - (R[6] * X + R[7] * Y + R[8] * Z)];
  const view = new Float32Array([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1]);
  return mul(proj, view);
}
