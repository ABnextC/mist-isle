Three.js r187 (three@0.187.0, MIT)
three.module.js + three.core.js 를 esbuild로 한 파일에 묶고 줄였다.

addons.min.js: 같은 버전의 examples/jsm에서 Sky, EffectComposer 계열 패스(RenderPass·OutputPass·UnrealBloomPass·GTAOPass·SMAAPass·FXAAPass), BufferGeometryUtils를 묶었다. "three"는 밖에 둔다(import map).
