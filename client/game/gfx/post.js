// 후처리: 장면(HDR) → 주변 그늘(GTAO) → 빛 번짐(블룸) → 톤 매핑 → 계단 현상 줄이기(SMAA/FXAA).
// 화질 '낮음'에서는 후처리 없이 바로 화면에 그린다.

import * as THREE from 'three';
import { GTAOPass, UnrealBloomPass, OutputPass, SMAAPass, FXAAPass } from 'three-addons';

export function createPost(renderer, scene, camera) {
  const size = new THREE.Vector2();
  const depth = new THREE.DepthTexture(1, 1);
  depth.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: depth });
  const workRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const ldrRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  let cfg = { post: false, ao: false, bloom: false, aa: null, aoFull: false, aoSamples: 12 };
  let aoSamples = 0;
  let gtao = null;
  let bloom = null;
  let smaa = null;
  let fxaa = null;
  const output = new OutputPass();
  // 색 보정(v1.0): 톤 매핑 뒤 화면색에서 대비를 살짝 세우고, 그늘은 푸르게·밝은 곳은 따뜻하게 나눈다
  const gradeRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const grade = new THREE.ShaderMaterial({
    uniforms: { tIn: { value: null }, uNight: { value: 0 }, uStrength: { value: 1 }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uRays: { value: 0 }, uSunCol: { value: new THREE.Color(1, 0.85, 0.6) }, uNF: { value: new THREE.Vector2(0.12, 6000) }, uTime: { value: 0 }, uGrain: { value: 0.012 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tIn; uniform float uNight; uniform float uStrength; varying vec2 vUv;
      uniform sampler2D tDepth; uniform vec2 uSun; uniform float uRays; uniform vec3 uSunCol; uniform vec2 uNF; uniform float uTime; uniform float uGrain;
      // 하늘인가: 깊이를 거리로 펴서 아주 먼 것만 하늘로 본다
      float skyAt(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        float z = uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x));
        return smoothstep(2600.0, 3600.0, z);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 c = texture2D(tIn, vUv).rgb;
        vec3 o = c;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // 채도: 어두운 곳은 덜, 중간 밝기는 조금 더
        c = mix(vec3(l), c, 1.07 + 0.05 * (1.0 - abs(l - 0.5) * 2.0) - 0.12 * uNight);
        // 부드러운 S자 대비
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
        // 그늘·밝은 곳 색 나누기(밤엔 더 푸르게)
        vec3 shadowTint = mix(vec3(0.95, 0.99, 1.05), vec3(0.88, 0.95, 1.1), uNight);
        vec3 lightTint = mix(vec3(1.035, 1.0, 0.955), vec3(1.0, 1.0, 1.02), uNight);
        c *= mix(shadowTint, lightTint, smoothstep(0.15, 0.75, l));
        // 빛내림(v2.0): 해 쪽으로 하늘 구멍을 모아 안개 속 햇살 기둥을 만든다
        if (uRays > 0.001) {
          vec2 dlt = (uSun - vUv) / 28.0;
          vec2 p = vUv + dlt * hash(vUv * 811.0 + uTime);
          float acc = 0.0;
          float w = 1.0;
          for (int i = 0; i < 28; i++) {
            acc += skyAt(p) * w;
            w *= 0.955;
            p += dlt;
          }
          float fall = 1.0 - smoothstep(0.0, 0.95, distance(vUv, uSun));
          c += uSunCol * acc / 28.0 * fall * uRays * (1.0 - 0.6 * l);
        }
        // 필름 결(v2.0): 아주 옅은 알갱이
        c += (hash(vUv * 1371.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
        gl_FragColor = vec4(mix(o, clamp(c, 0.0, 1.0), uStrength), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), grade);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function ensure() {
    if (cfg.ao && !gtao) {
      gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: depth });
      gtao.blendIntensity = 0.85;
    }
    if (gtao && aoSamples !== cfg.aoSamples) {
      aoSamples = cfg.aoSamples;
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: aoSamples });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: aoSamples });
    }
    if (cfg.bloom && !bloom) {
      bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.14, 0.5, 4.6);
      // 해 원반은 HDR 값이 수천이라 블룸이 화면 전체를 하얗게 덮었다(새벽 역광, v2.1). 번질 빛의 밝기에 상한을 둔다
      const hp = bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace(
        'gl_FragColor = mix( outputColor, texel, alpha );',
        'vec4 o = mix( outputColor, texel, alpha ); float bl = dot( o.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ); o.rgb *= min( 1.0, 12.0 / max( bl, 1e-4 ) ); gl_FragColor = o;',
      );
      hp.needsUpdate = true;
    }
    if (cfg.aa === 'smaa' && !smaa) smaa = new SMAAPass();
    if (cfg.aa === 'fxaa' && !fxaa) fxaa = new FXAAPass();
  }

  function setSize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    sceneRT.setSize(w, h);
    workRT.setSize(w, h);
    ldrRT.setSize(w, h);
    gradeRT.setSize(w, h);
    if (gtao) gtao.setSize(cfg.aoFull ? w : Math.ceil(w / 2), cfg.aoFull ? h : Math.ceil(h / 2));
    if (bloom) bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    if (smaa) smaa.setSize(w, h);
    if (fxaa) fxaa.setSize(w, h);
  }

  function configure(tier) {
    cfg = { post: tier.post, ao: tier.ao, bloom: tier.bloom, aa: tier.aa, aoFull: !!tier.aoFull, aoSamples: tier.aoSamples || 12 };
    ensure();
    setSize();
  }

  function render() {
    if (!cfg.post) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    let read = sceneRT;
    if (cfg.ao) {
      gtao.render(renderer, workRT, read);
      read = workRT;
    }
    if (cfg.bloom) bloom.render(renderer, null, read, 0, false);
    const aa = cfg.aa === 'smaa' ? smaa : cfg.aa === 'fxaa' ? fxaa : null;
    output.renderToScreen = false;
    output.render(renderer, ldrRT, read);
    grade.uniforms.tIn.value = ldrRT.texture;
    grade.uniforms.tDepth.value = depth;
    grade.uniforms.uNF.value.set(camera.near, camera.far);
    renderer.setRenderTarget(aa ? gradeRT : null);
    renderer.render(quadScene, quadCam);
    if (aa) {
      aa.renderToScreen = true;
      aa.render(renderer, null, gradeRT);
    }
  }

  // 작은 사진(v2.0 초상화): 후처리를 쓰면 본 장면과 같은 HDR 타깃 조건으로 그려 셰이더를 새로 만들지 않는다
  let snapRT = null;
  let snapLdr = null;
  function snapshot(cam, S) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const prev = renderer.getRenderTarget();
    if (!cfg.post) {
      const pv = new THREE.Vector4();
      renderer.getViewport(pv);
      const dpr = renderer.getPixelRatio();
      renderer.setRenderTarget(null);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, S / dpr, S / dpr);
      renderer.setScissor(0, 0, S / dpr, S / dpr);
      renderer.render(scene, cam);
      c.getContext('2d').drawImage(renderer.domElement, 0, renderer.domElement.height - S, S, S, 0, 0, S, S);
      renderer.setScissorTest(false);
      renderer.setViewport(pv.x / dpr, pv.y / dpr, pv.z / dpr, pv.w / dpr);
      renderer.setRenderTarget(prev);
      return c;
    }
    if (!snapRT || snapRT.width !== S) {
      snapRT?.dispose();
      snapLdr?.dispose();
      const d = new THREE.DepthTexture(S, S);
      d.type = THREE.UnsignedIntType;
      snapRT = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, depthTexture: d });
      snapLdr = new THREE.WebGLRenderTarget(S, S, { depthBuffer: false });
    }
    renderer.setRenderTarget(snapRT);
    renderer.render(scene, cam);
    output.renderToScreen = false;
    output.render(renderer, snapLdr, snapRT);
    const buf = new Uint8Array(S * S * 4);
    renderer.readRenderTargetPixels(snapLdr, 0, 0, S, S, buf);
    renderer.setRenderTarget(prev);
    const img = new ImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    c.getContext('2d').putImageData(img, 0, 0);
    return c;
  }

  // 장면을 그릴 실제 타깃(후처리를 쓰면 HDR 타깃). 미리 컴파일할 때 같은 조건을 맞춘다
  const target = () => (cfg.post ? sceneRT : null);
  const setNight = (n) => { grade.uniforms.uNight.value = n; };
  const setGrade = (k) => { grade.uniforms.uStrength.value = k; };
  // 빛내림(v2.0): 해의 화면 자리(0~1)와 세기
  const setRays = (sx, sy, k, col, t) => {
    grade.uniforms.uSun.value.set(sx, sy);
    grade.uniforms.uRays.value = k;
    if (col) grade.uniforms.uSunCol.value.copy(col);
    grade.uniforms.uTime.value = t;
  };
  return { configure, setSize, render, target, setNight, setGrade, setRays, snapshot, get bloomPass() { return bloom; } };
}
