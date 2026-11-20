// 캐릭터 재질(v0.5): 피부(감싸는 빛으로 살 속 산란 흉내, 털 가면으로 머리색), 옷(꼭짓점 색·재질 칸·삼면 투영 결),
// 눈(투명 코팅, 홍채 색), 속눈썹·머리카락(알파 자르기 + 결 따라 반짝임).
import * as THREE from 'three';

// 피부: skinA(RGB 바탕색 sRGB, A 주변 가림), skinB(RG 법선, B 거칠기, A 털 가면: 0.5↑ 정수리·눈썹, 0.5↓ 수염)
export function skinMaterial(A, B) {
  const m = new THREE.MeshStandardMaterial({ map: A, normalMap: B, roughness: 1, metalness: 0 });
  m.normalScale.set(1, 1);
  const U = { uTone: { value: new THREE.Color(1, 1, 1) }, uHair: { value: new THREE.Color(0.08, 0.05, 0.035) }, uSkinB: { value: B } };
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTone;\nuniform vec3 uHair;\nuniform sampler2D uSkinB;\nfloat gSkinAO = 1.0;')
      .replace('#include <map_fragment>', `
        vec4 sA = texture2D( map, vMapUv );
        vec4 sB = texture2D( uSkinB, vMapUv );
        gSkinAO = sA.a;
        vec3 skinC = sA.rgb * uTone;
        float scalp = clamp( sB.a * 2.0 - 1.0, 0.0, 1.0 );
        float stub = clamp( 1.0 - sB.a * 2.0, 0.0, 1.0 );
        skinC = mix( skinC, uHair * 1.2, scalp * 0.95 );
        skinC = mix( skinC, skinC * mix( vec3( 1.0 ), uHair * 3.0 + 0.25, 0.6 ), stub );
        diffuseColor.rgb *= skinC;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sB.b;')
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = vec3( sB.rg * 2.0 - 1.0, 0.0 );
        mapN.z = sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) );
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.22 * gSkinAO;
        reflectedLight.indirectDiffuse *= gSkinAO;
        reflectedLight.indirectSpecular *= gSkinAO * gSkinAO;
        reflectedLight.directDiffuse *= mix( 1.0, gSkinAO, 0.45 );`)
      .replace('reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );', `
        float nlW = dot( geometryNormal, directLight.direction );
        vec3 wrapW = vec3( saturate( ( nlW + 0.32 ) / 1.32 ), saturate( ( nlW + 0.13 ) / 1.13 ), saturate( ( nlW + 0.09 ) / 1.09 ) );
        reflectedLight.directDiffuse += directLight.color * wrapW * diffuseBRDF * ( 1.0 - F );`);
  };
  m.customProgramCacheKey = () => 'char-skin';
  return m;
}

// 옷 재질 칸(파이썬 outfit.GID와 같은 번호). 칸마다 거칠기·결 종류·결 크기·반짝임
// 결: 0 리넨(평직), 1 모직(능직), 2 가죽, 3 금속
const SLOT = [
  [0.88, 0, 1.0, 0.0], // 0 셔츠
  [0.82, 1, 1.0, 0.0], // 1 조끼
  [0.86, 1, 0.8, 0.0], // 2 바지
  [0.55, 2, 1.0, 0.0], // 3 장화
  [0.5, 2, 1.2, 0.0], // 4 허리띠
  [0.9, 0, 1.3, 0.0], // 5 목수건
  [0.55, 2, 1.0, 0.0], // 6 끈
  [0.92, 0, 0.7, 0.0], // 7 배낭(캔버스)
  [0.32, 3, 1.0, 1.0], // 8 금속
  [0.75, 2, 2.0, 0.0], // 9 밑창
  [0.5, 2, 1.4, 0.0], // 10 가죽 테두리
];
export const CLOTH_SLOTS = SLOT.length;

export function clothMaterial(detail) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.BackSide });
  const tints = [];
  for (let i = 0; i < 12; i++) tints.push(new THREE.Color(1, 1, 1));
  const U = { uTint: { value: tints }, uDetail: { value: detail }, uSlot: { value: SLOT.map((s) => new THREE.Vector4(...s)) } };
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nattribute float aEdge;\nvarying float vMat;\nvarying float vEdge;\nvarying vec3 vRest;\nvarying vec3 vRestN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;\nvEdge = aEdge;\nvRest = position;\nvRestN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uTint[12];
        uniform vec4 uSlot[11];
        uniform sampler2D uDetail;
        varying float vMat;
        varying float vEdge;
        varying vec3 vRest;
        varying vec3 vRestN;
        float gClothH = 0.0;
        float gClothAO = 1.0;
        float detailH( vec3 p, vec3 n, int kind, float sc ) {
          vec3 w = pow( abs( n ), vec3( 4.0 ) );
          w /= ( w.x + w.y + w.z );
          float f = ( kind == 0 ) ? 26.0 : ( kind == 1 ) ? 20.0 : ( kind == 2 ) ? 9.0 : 4.0;
          f *= sc;
          vec4 a = texture2D( uDetail, p.zy * f );
          vec4 b = texture2D( uDetail, p.xz * f );
          vec4 c = texture2D( uDetail, p.xy * f );
          vec4 t = a * w.x + b * w.y + c * w.z;
          return ( kind == 0 ) ? t.r : ( kind == 1 ) ? t.g : ( kind == 2 ) ? t.b : t.a * 0.3;
        }`)
      .replace('#include <color_fragment>', `
        int slot = int( vMat + 0.5 );
        vec4 sp = uSlot[ slot ];
        int kind = int( sp.y + 0.5 );
        gClothAO = vColor.a;
        diffuseColor.rgb *= uTint[ slot ] * vColor.rgb * 1.4;
        gClothH = detailH( vRest, normalize( vRestN ), kind, sp.z );
        float dFq = ( kind == 0 ) ? 26.0 : ( kind == 1 ) ? 20.0 : ( kind == 2 ) ? 9.0 : 4.0;
        float texPerPx = length( fwidth( vRest ) ) * dFq * sp.z * 512.0;
        float dFade = clamp( 1.6 - texPerPx * 0.6, 0.0, 1.0 );
        gClothH = mix( 0.5, gClothH, dFade );
        diffuseColor.rgb *= 0.93 + 0.14 * gClothH;
        float edgeW = 1.0 - smoothstep( 0.0, 0.12, vEdge );
        diffuseColor.rgb *= 1.0 - 0.18 * edgeW;
        if ( !gl_FrontFacing ) diffuseColor.rgb *= 0.45;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp( sp.x + ( gClothH - 0.5 ) * 0.12, 0.05, 1.0 );')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sp.w;')
      .replace('#include <normal_fragment_maps>', `
        {
          vec2 dH = vec2( dFdx( gClothH ), dFdy( gClothH ) ) * ( kind == 2 ? 0.9 : 1.2 );
          vec3 sX = normalize( dFdx( -vViewPosition ) );
          vec3 sY = normalize( dFdy( -vViewPosition ) );
          vec3 R1 = cross( sY, normal );
          vec3 R2 = cross( normal, sX );
          float det = dot( sX, R1 ) * faceDirection;
          vec3 grad = sign( det ) * ( dH.x * R1 + dH.y * R2 );
          normal = normalize( abs( det ) * normal - grad );
        }`)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.16 * gClothAO;
        reflectedLight.indirectDiffuse *= gClothAO;
        reflectedLight.indirectSpecular *= gClothAO;
        if ( kind < 2 ) {
          float fr = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
          reflectedLight.indirectDiffuse += diffuseColor.rgb * fr * 0.35 * gClothAO;
        }`);
  };
  m.customProgramCacheKey = () => 'char-cloth';
  return m;
}

// 눈: 바탕(흰자·홍채 회색) + A(홍채 가면) → 홍채 색. 가장자리(눈꺼풀 그늘) 어둡게
export function eyeMaterial(tex) {
  const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.03, metalness: 0 });
  const U = { uIris: { value: new THREE.Color(0.32, 0.2, 0.11) } };
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEyeL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeL = normalize( position );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uIris;\nvarying vec3 vEyeL;')
      .replace('#include <map_fragment>', `
        vec4 eT = texture2D( map, vMapUv );
        vec3 eC = mix( eT.rgb, uIris * eT.r * 2.4, eT.a );
        float rim = smoothstep( 0.55, 0.15, vEyeL.z );
        eC *= ( 1.0 - 0.55 * rim ) * mix( 0.86, 1.0, eT.a );
        eC *= 1.0 - 0.35 * smoothstep( 0.18, 0.5, vEyeL.y );
        diffuseColor.rgb *= eC;`);
  };
  m.customProgramCacheKey = () => 'char-eye';
  return m;
}

export function lashMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.7, color: 0x1e1510 });
  m.customProgramCacheKey = () => 'char-lash';
  return m;
}

// 머리카락 카드: 텍스처 R(가닥 밝기), G(속 그늘), B(가닥 번호), A(덮임). 2단 그리기(속 알파 자르기 + 겉 부드러운 끝)는 actor.js에서
export function hairMaterial(tex, soft = false) {
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.68, metalness: 0, vertexColors: true, envMapIntensity: 0.1 });
  if (soft) {
    m.transparent = true;
    m.depthWrite = false;
  } else {
    m.alphaTest = 0.5;
  }
  const U = { uHair: { value: new THREE.Color(0.08, 0.05, 0.035) } };
  m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aTan;\nvarying vec3 vTanV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTanV = normalize( ( modelViewMatrix * vec4( aTan, 0.0 ) ).xyz );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHair;\nvarying vec3 vTanV;\nfloat gHairSh = 0.5;\nfloat gHairAO = 1.0;')
      .replace('#include <map_fragment>', `
        vec4 hT = texture2D( map, vMapUv );
        float hA = hT.a;
        ${soft ? 'if ( hA >= 0.5 || hA < 0.1 ) discard; hA = hA * 1.1;' : ''}
        gHairSh = hT.b;
        gHairAO = mix( 0.35, 1.0, hT.g ) * vColor.a;
        vec3 qHairCol = uHair * ( 0.75 + 0.5 * hT.r ) * vColor.rgb * 1.6;
        diffuseColor = vec4( qHairCol, hA );`)
      .replace('#include <color_fragment>', '')
      .replace('#include <alphatest_fragment>', soft ? '' : '#include <alphatest_fragment>')
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.18 * gHairAO;
        reflectedLight.indirectDiffuse *= gHairAO;
        reflectedLight.directDiffuse *= mix( 0.6, 1.0, gHairAO );
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 L = directionalLights[ 0 ].direction;
          vec3 V = normalize( vViewPosition );
          vec3 T = normalize( vTanV );
          vec3 H = normalize( L + V );
          float shift = ( gHairSh - 0.5 ) * 0.25;
          vec3 T1 = normalize( T + normal * ( 0.08 + shift ) );
          vec3 T2 = normalize( T + normal * ( -0.12 + shift ) );
          float th1 = dot( T1, H );
          float th2 = dot( T2, H );
          float s1 = pow( max( 0.0, sqrt( max( 0.0, 1.0 - th1 * th1 ) ) ), 90.0 );
          float s2 = pow( max( 0.0, sqrt( max( 0.0, 1.0 - th2 * th2 ) ) ), 18.0 );
          float nl = saturate( dot( normal, L ) * 0.6 + 0.4 );
          vec3 lc = directionalLights[ 0 ].color;
          reflectedLight.directSpecular += lc * nl * gHairAO * ( s1 * 0.08 * mix( vec3( 1.0 ), uHair * 6.0, 0.4 ) + s2 * 0.14 * uHair * 5.0 );
          reflectedLight.directSpecular *= 0.5;
        }
        #endif`);
  };
  m.customProgramCacheKey = () => (soft ? 'char-hair-soft' : 'char-hair');
  return m;
}
