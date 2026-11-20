// GLSL of the teardown view.
//
// The scanner measures one 3D point per pixel of its picture. A step is stored as three images on one pixel grid
// (depth, picture, instance id), and the vertex shader turns grid cell number gl_VertexID back into a point:
// no vertex buffers. Two neighbouring steps are bound at once and mixed by uT, so a part that was removed
// sinks onto the surface it uncovered. Only measured points are drawn: nothing is filled in or meshed.

export const VS_POINTS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uDA, uDB, uCA, uCB, uLA, uLB, uInstCol, uInstXf;
uniform ivec2 uCells;        // drawn cells per row, per column
uniform int uStride, uK, uHover;
uniform float uT;
uniform mat4 uMVP;
uniform vec4 uIntr;          // fx, fy, cx, cy of the scanner
uniform vec2 uCrop;          // top-left pixel of the stored window in the scanner picture
uniform vec3 uZ;             // zmin, zmax - zmin, levels
uniform vec2 uZr;            // near and far end of the depth colour scale, mm
uniform float uPx, uClass, uDepth, uApart;
out vec3 vCol;
flat out int vId;

float code(vec4 t){ return floor(t.r*255.0+0.5)*256.0 + floor(t.g*255.0+0.5); }
int ident(vec4 t){ return int(t.r*255.0+0.5)*256 + int(t.g*255.0+0.5); }
vec3 turbo(float x){
  const vec4 kR = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kG = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kB = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kR2 = vec2(-152.94239396, 59.28637943), kG2 = vec2(4.27729857, 2.82956604), kB2 = vec2(-89.90310912, 27.34824973);
  vec4 v4 = vec4(1.0, x, x*x, x*x*x); vec2 v2 = v4.zw*v4.z;
  return clamp(vec3(dot(v4,kR)+dot(v2,kR2), dot(v4,kG)+dot(v2,kG2), dot(v4,kB)+dot(v2,kB2)), 0.0, 1.0);
}
void hide(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); vId = 0; }

void main(){
  ivec2 p = ivec2(gl_VertexID % uCells.x, gl_VertexID / uCells.x) * uStride;
  vec4 ta = texelFetch(uDA, p, 0), tb = texelFetch(uDB, p, 0);
  bool ma = ta.b > 0.5, mb = tb.b > 0.5;                       // measured in step A, in step B
  if(!ma && !mb){ hide(); return; }
  float za = uZ.x + (code(ta)-1.0)/uZ.z*uZ.y, zb = uZ.x + (code(tb)-1.0)/uZ.z*uZ.y;
  ivec2 fp = p*uK + uK/2;                                      // the same place in the full-resolution picture and id map
  vec3 ca = texelFetch(uCA, fp, 0).rgb, cb = texelFetch(uCB, fp, 0).rgb;
  int ia = ident(texelFetch(uLA, fp, 0)), ib = ident(texelFetch(uLB, fp, 0));
  float a = 1.0;                                               // how much of the point shows
  if(!ma){ za = zb; ca = cb; ia = ib; a = uT; }
  if(!mb){ zb = za; cb = ca; ib = ia; a = 1.0-uT; }
  if(ia == 0 && ib == 0){ hide(); return; }                    // outside every mask: the table
  if(ia == 0) a = min(a, uT); else if(ib == 0) a = min(a, 1.0-uT);
  int id = uT < 0.5 ? (ia != 0 ? ia : ib) : (ib != 0 ? ib : ia);
  float z = mix(za, zb, uT);
  vec3 col = mix(ca, cb, uT);
  vec4 xf = mix(texelFetch(uInstXf, ivec2(ia,0), 0), texelFetch(uInstXf, ivec2(ib,0), 0), uT);
  vec3 cc = texelFetch(uInstCol, ivec2(id,0), 0).rgb;
  vec2 px = vec2(fp) + uCrop;
  vec3 pos = vec3((px.x-uIntr.z)*z/uIntr.x, (px.y-uIntr.w)*z/uIntr.y, z);
  pos.z -= xf.x*uApart; pos.xy += xf.yz*uApart;                // lift the part towards the scanner and push it outwards
  float g = (col.r+col.g+col.b)/3.0;
  col = mix(col, 0.45*vec3(g) + 0.75*cc, uClass);
  col = mix(col, turbo(clamp((uZr.y-z)/(uZr.y-uZr.x), 0.0, 1.0)), uDepth);
  if(uHover != 0 && id == uHover) col = mix(col, vec3(1.0), 0.32);
  vCol = pow(clamp(col, 0.0, 1.0), vec3(0.82));
  vId = id;
  gl_Position = uMVP*vec4(pos, 1.0);
  gl_PointSize = max(1.0, uPx/gl_Position.w) * smoothstep(0.0, 0.35, a);
}`;

export const FS_POINTS = `#version 300 es
precision highp float;
in vec3 vCol; flat in int vId;
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oId;
void main(){
  vec2 d = gl_PointCoord-0.5; if(dot(d,d) > 0.25) discard;
  oCol = vec4(vCol, 1.0);
  oId = vec4(float(vId/256)/255.0, float(vId%256)/255.0, 0.0, 1.0);
}`;

// One triangle that covers the screen.
export const VS_SCREEN = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

// Eye-dome lighting: a point is shaded towards a soft grey by how far it lies behind its neighbours on screen, so depth
// steps read as edges.
export const FS_EDL = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uCol, uDep;
uniform vec2 uNF; uniform float uStrength; uniform int uR; uniform vec3 uBg;
uniform vec3 uShadow;        // offset x, offset y (pixels, y up) and radius of the contact shadow
uniform float uShadowK;      // its strength
uniform vec3 uShade;         // its tint (the host's --stage-shade)
uniform vec3 uEdge;          // the colour the depth shading darkens towards (a soft grey, not black)
out vec4 o;
float lin(float d){ return 2.0*uNF.x*uNF.y/(uNF.y+uNF.x-(2.0*d-1.0)*(uNF.y-uNF.x)); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); float d = texelFetch(uDep, p, 0).r;
  ivec2 sz = textureSize(uDep, 0);
  if(d >= 1.0){
    // the stage: a soft shadow where the cloud stands, from 16 taps on a disc turned by a per-pixel angle
    float a = 6.2831853*fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), occ = 0.0;
    for(int i = 0; i < 16; i++){
      float r = sqrt((float(i)+0.5)/16.0)*uShadow.z, t = a + float(i)*2.39996323;
      ivec2 q = p + ivec2(uShadow.xy + r*vec2(cos(t), sin(t)));
      if(q.x >= 0 && q.y >= 0 && q.x < sz.x && q.y < sz.y && texelFetch(uDep, q, 0).r < 1.0) occ += 1.0;
    }
    o = vec4(mix(uBg, uShade, uShadowK*smoothstep(0.0, 1.0, occ/16.0)), 1.0);
    return;
  }
  float ld = log2(lin(d)), resp = 0.0;
  ivec2 offs[4] = ivec2[4](ivec2(uR,0), ivec2(-uR,0), ivec2(0,uR), ivec2(0,-uR));
  for(int i = 0; i < 4; i++){
    float dn = texelFetch(uDep, clamp(p+offs[i], ivec2(0), sz-1), 0).r;
    resp += max(0.0, ld - (dn >= 1.0 ? log2(uNF.y) : log2(lin(dn))));
  }
  o = vec4(mix(uEdge, texelFetch(uCol, p, 0).rgb, exp(-uStrength*resp)), 1.0);
}`;

// The scanner picture itself, drawn where the points project in the scanner's own view, with the masks over it.
export const VS_PHOTO = `#version 300 es
uniform vec2 uScale;
out vec2 vUv;
void main(){
  vec2 q = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = q;
  gl_Position = vec4((q*2.0-1.0)*vec2(uScale.x, -uScale.y), 0.0, 1.0);
}`;

export const FS_PHOTO = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uCA, uCB, uLA, uLB, uInstCol;
uniform float uT, uMask, uAlpha, uEdge;
uniform int uHover;
in vec2 vUv; out vec4 o;
int ident(vec4 t){ return int(t.r*255.0+0.5)*256 + int(t.g*255.0+0.5); }
int at(vec2 uv){ return uT < 0.5 ? ident(texture(uLA, uv)) : ident(texture(uLB, uv)); }
void main(){
  vec3 col = mix(texture(uCA, vUv).rgb, texture(uCB, vUv).rgb, uT);
  int id = at(vUv);
  vec2 e = uEdge/vec2(textureSize(uLA, 0));
  bool edge = at(vUv+vec2(e.x,0.0)) != id || at(vUv-vec2(e.x,0.0)) != id || at(vUv+vec2(0.0,e.y)) != id || at(vUv-vec2(0.0,e.y)) != id;
  if(id != 0){
    vec3 cc = texelFetch(uInstCol, ivec2(id,0), 0).rgb;
    bool hot = uHover != 0 && id == uHover;
    float fill = hot ? max(0.5, 0.62*uMask) : 0.5*uMask;
    col = mix(col, cc, fill);
    if(edge) col = mix(col, mix(cc, vec3(1.0), 0.55), hot ? 1.0 : 0.9*uMask);
  } else if(edge) {
    col = mix(col, vec3(1.0), 0.55*uMask);
  }
  o = vec4(col, uAlpha);
}`;
