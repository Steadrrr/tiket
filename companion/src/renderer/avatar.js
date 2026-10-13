import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const EXPRESSIONS = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];
const EMOTION_TO_EXPR = { joy: 'happy', angry: 'angry', sad: 'sad', surprised: 'surprised', relaxed: 'relaxed', neutral: null };
const ARM_DOWN = 1.15; // T-포즈에서 팔을 내리는 각도(rad)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

// VRM 이 없을 때 쓰는 기본 캐릭터 (같은 인터페이스: update / setEmotion / setMouth / setLook)
class PlaceholderRig {
  constructor() {
    this.root = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xffd9e3, roughness: 0.6 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xff8fab, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a40 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 8, 16), cloth);
    body.position.y = 0.62;
    this.head = new THREE.Group();
    this.head.position.y = 1.32;
    this.head.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 24), skin));
    this.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), dark);
      e.position.set(0.12 * s, 0.04, 0.3);
      this.head.add(e);
      return e;
    });
    this.mouth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc2455f }));
    this.mouth.position.set(0, -0.11, 0.31);
    this.head.add(this.mouth);
    this.root.add(body, this.head);
    this.mouthOpen = 0;
    this.emo = 'neutral';
    this.blink = 0;
    this.look = { x: 0, y: 0 };
  }
  setEmotion(name) { this.emo = name; }
  setMouth(v) { this.mouthOpen = v; }
  setLook(x, y) { this.look.x = x; this.look.y = y; }
  setBlink(v) { this.blink = v; }
  update(dt, t) {
    this.root.position.y = Math.sin(t * 1.6) * 0.008;
    this.head.rotation.y = damp(this.head.rotation.y, this.look.x * 0.5, 8, dt);
    this.head.rotation.x = damp(this.head.rotation.x, -this.look.y * 0.3, 8, dt);
    const squint = this.emo === 'joy' ? 0.35 : this.emo === 'sad' ? 0.6 : 1;
    for (const e of this.eyes) e.scale.y = Math.max(0.08, squint * (1 - this.blink));
    const wide = this.emo === 'surprised' ? 1.6 : 1;
    this.mouth.scale.set(this.emo === 'joy' ? 1.5 : wide, 0.25 + this.mouthOpen * 1.6 * wide, 1);
  }
}

class VrmRig {
  constructor(vrm) {
    this.vrm = vrm;
    this.root = vrm.scene;
    this.weights = Object.fromEntries(EXPRESSIONS.map((n) => [n, 0]));
    this.target = null;
    this.mouthOpen = 0;
    this.blink = 0;
    this.look = { x: 0, y: 0 };
    this.lookTarget = new THREE.Object3D();
    this.root.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.bone = (n) => vrm.humanoid?.getNormalizedBoneNode(n) ?? null;
  }
  setEmotion(name) { this.target = EMOTION_TO_EXPR[name] ?? null; }
  setMouth(v) { this.mouthOpen = v; }
  setLook(x, y) { this.look.x = x; this.look.y = y; }
  setBlink(v) { this.blink = v; }
  update(dt, t) {
    const em = this.vrm.expressionManager;
    if (em) {
      for (const n of EXPRESSIONS) {
        const goal = this.target === n ? (this.mouthOpen > 0.15 ? 0.55 : 0.85) : 0;
        this.weights[n] = damp(this.weights[n], goal, 10, dt);
        em.setValue(n, this.weights[n]);
      }
      em.setValue('blink', this.blink);
      em.setValue('aa', clamp(this.mouthOpen, 0, 1));
      em.setValue('oh', clamp(this.mouthOpen * 0.3 * (0.5 + 0.5 * Math.sin(t * 9)), 0, 1));
    }
    // 팔 내리기 + 숨쉬기 + 시선에 따른 머리 회전
    const set = (n, fn) => { const b = this.bone(n); if (b) fn(b); };
    set('leftUpperArm', (b) => { b.rotation.z = -ARM_DOWN; });
    set('rightUpperArm', (b) => { b.rotation.z = ARM_DOWN; });
    set('spine', (b) => { b.rotation.x = Math.sin(t * 1.6) * 0.012; });
    set('chest', (b) => { b.rotation.x = Math.sin(t * 1.6 + 0.4) * 0.01; });
    set('head', (b) => {
      b.rotation.y = damp(b.rotation.y, this.look.x * 0.45, 6, dt);
      b.rotation.x = damp(b.rotation.x, -this.look.y * 0.25, 6, dt);
    });
    this.lookTarget.position.set(this.look.x * 0.8, 1.45 + this.look.y * 0.5, 2);
    this.vrm.update(dt);
  }
}

export class Avatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    this.clock = new THREE.Clock();
    this.rig = null;
    this.blinkTimer = 2;
    this.blinkT = -1;
    this.probe = null; // {x, y, resolve}
    this.probeBuf = new Uint8Array(4);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setRig(new PlaceholderRig());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.rig) this.fit();
  }

  setRig(rig) {
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = rig;
    this.scene.add(rig.root);
    this.fit();
  }

  // 전신이 창 위쪽 ~70% 에 들어오도록 카메라를 맞춘다 (아래쪽은 말풍선/입력창 자리)
  fit() {
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const h = Math.max(0.5, box.max.y - box.min.y);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = Math.max((h * 1.22) / (2 * Math.tan(fov / 2)), (box.max.x - box.min.x) * 1.1 / (2 * Math.tan(fov / 2) * this.camera.aspect));
    const cy = (box.max.y + box.min.y) / 2 - h * 0.07;
    this.camera.position.set(0, cy, dist);
    this.camera.lookAt(0, cy, 0);
  }

  async loadVrm(bytes) {
    if (!bytes) { this.setRig(new PlaceholderRig()); return false; }
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await loader.parseAsync(buf, '');
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('VRM 데이터가 없는 파일이에요. (VRM 형식인지 확인해 주세요)');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // VRM0 모델이 뒤를 보는 문제 보정
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    this.setRig(new VrmRig(vrm));
    return true;
  }

  setEmotion(n) { this.rig.setEmotion(n); }
  setMouth(v) { this.rig.setMouth(v); }
  setLook(x, y) { this.rig.setLook(clamp(x, -1, 1), clamp(y, -1, 1)); }

  // (x, y) 위치에 캐릭터가 그려져 있는지 비동기로 확인한다 (다음 프레임에 1픽셀 읽음)
  hitTest(x, y) {
    return new Promise((resolve) => { this.probe?.resolve(false); this.probe = { x, y, resolve }; });
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    // 눈 깜빡임
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkT < 0) { this.blinkT = 0; this.blinkTimer = 2 + Math.random() * 4; }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      this.rig.setBlink(Math.sin(Math.min(this.blinkT / 0.18, 1) * Math.PI));
      if (this.blinkT > 0.18) { this.blinkT = -1; this.rig.setBlink(0); }
    }
    this.rig.update(dt, t);
    this.renderer.render(this.scene, this.camera);
    if (this.probe) {
      const gl = this.renderer.getContext();
      const dpr = this.renderer.getPixelRatio();
      const px = Math.floor(this.probe.x * dpr);
      const py = Math.floor((this.canvas.clientHeight - this.probe.y) * dpr);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.probeBuf); // 렌더 직후라야 읽힘
      this.probe.resolve(this.probeBuf[3] > 12);
      this.probe = null;
    }
  }
}
