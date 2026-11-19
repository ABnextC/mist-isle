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
  let cfg = { post: false, ao: false, bloom: false, aa: null };
  let gtao = null;
  let bloom = null;
  let smaa = null;
  let fxaa = null;
  const output = new OutputPass();

  function ensure() {
    if (cfg.ao && !gtao) {
      gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: depth });
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    }
    if (cfg.bloom && !bloom) bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.14, 0.5, 3.2);
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
    if (gtao) gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    if (bloom) bloom.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    if (smaa) smaa.setSize(w, h);
    if (fxaa) fxaa.setSize(w, h);
  }

  function configure(tier) {
    cfg = { post: tier.post, ao: tier.ao, bloom: tier.bloom, aa: tier.aa };
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
    output.renderToScreen = !aa;
    output.render(renderer, aa ? ldrRT : null, read);
    if (aa) {
      aa.renderToScreen = true;
      aa.render(renderer, null, ldrRT);
    }
  }

  // 장면을 그릴 실제 타깃(후처리를 쓰면 HDR 타깃). 미리 컴파일할 때 같은 조건을 맞춘다
  const target = () => (cfg.post ? sceneRT : null);
  return { configure, setSize, render, target };
}
