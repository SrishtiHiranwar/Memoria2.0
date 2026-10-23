import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type SceneName = 'garden' | 'shore' | 'sunroom';
type EnvironmentScene = {
  group: THREE.Group;
  animate: (elapsed: number) => void;
  walker?: THREE.Group;
  walking?: (elapsed: number, delta: number, active: boolean) => void;
};

const environments: Array<{ id: SceneName; title: string; description: string; color: string }> = [
  { id: 'garden', title: 'Garden stroll', description: 'A sunny path among flowers, trees, and a quiet bench.', color: '#7c9e75' },
  { id: 'shore', title: 'Seaside pause', description: 'Soft dunes, blue water, and a warm afternoon sun.', color: '#6f9ba4' },
  { id: 'sunroom', title: 'Sunny reading room', description: 'A comfortable chair, a little table, and a bright window.', color: '#d1976a' },
];

function material(color: THREE.ColorRepresentation, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  color: THREE.ColorRepresentation,
  position: [number, number, number],
  options: { roughness?: number } = {},
) {
  const geometry = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, material(color, options.roughness));
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function sphere(
  parent: THREE.Object3D,
  radius: number,
  color: THREE.ColorRepresentation,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 22, 16), material(color));
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  topRadius: number,
  bottomRadius: number,
  height: number,
  color: THREE.ColorRepresentation,
  position: [number, number, number],
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, 14),
    material(color),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeLimb(length: number, color: THREE.ColorRepresentation) {
  const pivot = new THREE.Group();
  cylinder(pivot, 0.075, 0.09, length, color, [0, -length / 2, 0]);
  return pivot;
}

function createWalkingCompanion(parent: THREE.Object3D) {
  const walker = new THREE.Group();
  const body = new THREE.Group();
  walker.add(body);

  sphere(body, 0.31, '#efc39d', [0, 1.75, 0], [0.9, 1, 0.82]);
  sphere(body, 0.34, '#6e655d', [0, 1.96, 0.06], [1, 0.64, 0.86]);
  sphere(body, 0.16, '#6e655d', [-0.25, 1.87, 0.04], [1, 0.92, 1]);
  sphere(body, 0.16, '#6e655d', [0.25, 1.87, 0.04], [1, 0.92, 1]);
  sphere(body, 0.055, '#453c38', [-0.11, 1.78, -0.245], [1, 1, 0.55]);
  sphere(body, 0.055, '#453c38', [0.11, 1.78, -0.245], [1, 1, 0.55]);
  sphere(body, 0.045, '#d28c75', [0, 1.69, -0.27], [0.82, 0.55, 0.5]);

  const smileCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.095, 1.64, -0.265),
    new THREE.Vector3(0, 1.61, -0.29),
    new THREE.Vector3(0.095, 1.64, -0.265),
  ]);
  const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 10, 0.018, 6, false), material('#8b514b'));
  body.add(smile);

  cylinder(body, 0.27, 0.43, 0.9, '#df9273', [0, 0.96, 0]);
  sphere(body, 0.24, '#f0caa2', [0, 1.36, 0], [0.7, 0.46, 0.7]);
  const leftArm = makeLimb(0.68, '#df9273');
  const rightArm = makeLimb(0.68, '#df9273');
  leftArm.position.set(-0.34, 1.26, 0);
  rightArm.position.set(0.34, 1.26, 0);
  body.add(leftArm, rightArm);
  sphere(leftArm, 0.1, '#efc39d', [0, -0.67, 0]);
  sphere(rightArm, 0.1, '#efc39d', [0, -0.67, 0]);

  const leftLeg = makeLimb(0.48, '#607e79');
  const rightLeg = makeLimb(0.48, '#607e79');
  leftLeg.position.set(-0.13, 0.58, 0);
  rightLeg.position.set(0.13, 0.58, 0);
  body.add(leftLeg, rightLeg);
  sphere(leftLeg, 0.13, '#765d4b', [0, -0.48, -0.055], [1, 0.65, 1.5]);
  sphere(rightLeg, 0.13, '#765d4b', [0, -0.48, -0.055], [1, 0.65, 1.5]);

  cylinder(body, 0.34, 0.34, 0.12, '#eac978', [0, 2.13, 0.02]);
  cylinder(body, 0.19, 0.21, 0.18, '#eac978', [0, 2.22, 0.02]);

  walker.position.set(0.55, 0, -50);
  walker.rotation.y = Math.PI;
  parent.add(walker);
  let walkDistance = 0;
  return {
    walker,
    walk: (elapsed: number, delta: number, active: boolean) => {
      if (active) walkDistance += delta;
      const phase = elapsed * 2.2;
      walker.position.z = -50 + (walkDistance % 58);
      const gait = active ? Math.sin(phase) : 0;
      body.position.y = active ? Math.abs(Math.sin(phase * 2)) * 0.045 : 0;
      leftArm.rotation.x = gait * 0.34;
      rightArm.rotation.x = -gait * 0.34;
      leftLeg.rotation.x = gait * 0.38;
      rightLeg.rotation.x = -gait * 0.38;
    },
  };
}

type WalkQuestion = {
  question: string;
  hindiQuestion: string;
  choices: Array<{ label: string; hindiLabel: string; reply: string; hindiReply: string }>;
};

type GuidedStory = {
  question: string;
  answerOptions: string[];
  selectedIndex: number;
  expectedAnswer: string;
  onChoose: (index: number) => void;
  onContinue: () => void;
  continueLabel: string;
  busy: boolean;
};

const walkQuestions: WalkQuestion[] = [
  {
    question: 'What shall we look at first?',
    hindiQuestion: 'हम सबसे पहले क्या देखें?',
    choices: [
      { label: 'The flowers', hindiLabel: 'फूल', reply: 'The flowers are lovely. These colors make the garden feel so cheerful.', hindiReply: 'फूल बहुत सुंदर हैं। इनके रंग बगीचे को कितना खुशमिज़ाज बनाते हैं।' },
      { label: 'The butterflies', hindiLabel: 'तितलियाँ', reply: 'A butterfly! It is lovely to watch it drift gently through the garden.', hindiReply: 'एक तितली! इसे बगीचे में धीरे-धीरे उड़ते देखना कितना अच्छा है।' },
      { label: 'The big trees', hindiLabel: 'बड़े पेड़', reply: 'Those trees give us a lovely bit of shade. It feels nice to walk here together.', hindiReply: 'वे पेड़ कितनी प्यारी छाँव देते हैं। यहाँ साथ चलना अच्छा लगता है।' },
    ],
  },
  {
    question: 'Would you like to keep strolling or rest on the bench?',
    hindiQuestion: 'क्या आप टहलना चाहेंगे या बेंच पर आराम करेंगे?',
    choices: [
      { label: 'Let’s keep walking', hindiLabel: 'चलते रहें', reply: 'Of course. We can wander at an easy pace and enjoy the sunshine.', hindiReply: 'ज़रूर। हम आराम से टहलेंगे और धूप का आनंद लेंगे।' },
      { label: 'Let’s rest a little', hindiLabel: 'थोड़ा आराम करें', reply: 'That sounds lovely. Let’s sit for a moment and enjoy the quiet.', hindiReply: 'यह अच्छा रहेगा। थोड़ी देर बैठकर इस शांति का आनंद लेते हैं।' },
      { label: 'I’d like to look around', hindiLabel: 'आसपास देखें', reply: 'Take all the time you like. There is no hurry at all.', hindiReply: 'जितना मन हो उतना समय लें। हमें कोई जल्दी नहीं है।' },
    ],
  },
  {
    question: 'What sounds nice on a sunny afternoon?',
    hindiQuestion: 'धूप भरी दोपहर में क्या अच्छा लगेगा?',
    choices: [
      { label: 'A cup of tea', hindiLabel: 'एक कप चाय', reply: 'A warm cup of tea sounds perfect. We can imagine one waiting at home.', hindiReply: 'गरम चाय का प्याला कितना अच्छा लगेगा। सोचिए, घर पर हमारा इंतज़ार कर रहा है।' },
      { label: 'Sitting in the garden', hindiLabel: 'बगीचे में बैठना', reply: 'A peaceful afternoon in the garden sounds wonderful to me too.', hindiReply: 'बगीचे में सुकून भरी दोपहर मुझे भी बहुत अच्छी लगती है।' },
      { label: 'A friendly chat', hindiLabel: 'प्यारी-सी बातचीत', reply: 'I’m glad we can share this little walk and chat together.', hindiReply: 'मुझे खुशी है कि हम साथ में यह छोटी-सी सैर और बातचीत कर रहे हैं।' },
    ],
  },
  {
    question: 'Shall we wave hello to the garden, or take one last look at the flowers?',
    hindiQuestion: 'क्या हम बगीचे को हाथ हिलाकर नमस्ते कहें, या फूलों को एक बार फिर देखें?',
    choices: [
      { label: 'Wave hello', hindiLabel: 'हाथ हिलाकर नमस्ते', reply: 'Hello, lovely garden! Thank you for sharing this peaceful walk with us.', hindiReply: 'नमस्ते, प्यारे बगीचे! हमारे साथ यह शांत सैर साझा करने के लिए धन्यवाद।' },
      { label: 'One last look at the flowers', hindiLabel: 'फूलों को एक बार फिर देखें', reply: 'What a lovely way to finish our stroll. I’m happy we took this time together.', hindiReply: 'सैर पूरी करने का कितना प्यारा तरीका है। मुझे खुशी है कि हमने यह समय साथ बिताया।' },
      { label: 'Let’s sit a little longer', hindiLabel: 'थोड़ी देर और बैठें', reply: 'Of course. We can stay here together for as long as you like.', hindiReply: 'ज़रूर। जितनी देर चाहें, हम यहाँ साथ बैठ सकते हैं।' },
    ],
  },
];

function createGardenWalk(scene: THREE.Scene): EnvironmentScene {
  const group = new THREE.Group();
  scene.add(group);
  box(group, [26, 0.25, 100], '#94ae78', [0, -0.3, -22]);
  box(group, [2.8, 0.08, 100], '#dfc99f', [0, -0.14, -22]);

  for (let section = 0; section < 5; section += 1) {
    const z = 8 - section * 14;
    cylinder(group, 0.32, 0.43, 2.6, '#806147', [-5.2, 1.05, z - 4]);
    sphere(group, 2.05, '#58845e', [-5.2, 3.08, z - 4], [1, 0.9, 1]);
    sphere(group, 1.5, '#6f9968', [-4.2, 2.95, z - 4.1], [0.85, 0.82, 0.9]);
    cylinder(group, 0.32, 0.43, 2.6, '#806147', [5.4, 1.05, z - 10]);
    sphere(group, 2.05, '#658e62', [5.4, 3.08, z - 10], [1, 0.9, 1]);
    sphere(group, 1.5, '#7da16c', [4.5, 2.96, z - 10], [0.85, 0.82, 0.9]);
  }

  for (let index = 0; index < 120; index += 1) {
    const x = (Math.sin(index * 12.73) * 10.5) + (index % 2 ? 3.2 : -3.2);
    const z = 10 - ((index * 7.31) % 62);
    const flowerColors = ['#d97d6e', '#e5c25d', '#9c91bd', '#f0e2be'];
    const petal = flowerColors[index % flowerColors.length];
    cylinder(group, 0.035, 0.05, 0.44 + (index % 3) * 0.08, '#64845b', [x, 0.06, z]);
    sphere(group, 0.15, petal, [x, 0.42 + (index % 3) * 0.08, z], [1, 0.85, 1]);
    sphere(group, 0.055, '#e9d38a', [x, 0.44 + (index % 3) * 0.08, z], [1, 1, 1]);
  }

  const butterfly = new THREE.Group();
  const body = cylinder(butterfly, 0.045, 0.055, 0.36, '#4a574a', [0, 0, 0]);
  body.rotation.x = Math.PI / 2;
  sphere(butterfly, 0.18, '#d77f71', [-0.16, 0.02, 0], [1, 0.74, 0.22]);
  sphere(butterfly, 0.18, '#e5bd60', [0.16, 0.02, 0], [1, 0.74, 0.22]);
  group.add(butterfly);

  const companion = createWalkingCompanion(group);
  return {
    group,
    walker: companion.walker,
    animate: (elapsed) => {
      butterfly.position.set(Math.sin(elapsed * 0.33) * 3.5, 1.9 + Math.sin(elapsed * 1.1) * 0.22, Math.cos(elapsed * 0.33) * 2.5 - 1);
      butterfly.rotation.y = Math.cos(elapsed * 0.33) * 0.7;
      butterfly.rotation.z = Math.sin(elapsed * 2.2) * 0.12;
    },
    walking: companion.walk,
  };
}

function createGarden(scene: THREE.Scene): EnvironmentScene {
  const group = new THREE.Group();
  scene.add(group);
  box(group, [24, 0.25, 24], '#92ad76', [0, -0.3, 0]);

  const pathShape = new THREE.Shape();
  pathShape.moveTo(-1.05, -12);
  pathShape.lineTo(1.05, -12);
  pathShape.quadraticCurveTo(0.3, -5, 0.95, 0);
  pathShape.quadraticCurveTo(1.65, 6, 0.5, 12);
  pathShape.lineTo(-0.9, 12);
  pathShape.quadraticCurveTo(0.25, 5, -0.6, 0);
  pathShape.quadraticCurveTo(-1.35, -6, -1.05, -12);
  const path = new THREE.Mesh(new THREE.ShapeGeometry(pathShape), material('#ddc59c'));
  path.rotation.x = -Math.PI / 2;
  path.position.y = -0.16;
  path.receiveShadow = true;
  group.add(path);

  sphere(group, 4.1, '#a6bb83', [-7, -0.15, -6], [1.35, 0.36, 0.72]);
  sphere(group, 3.1, '#b3c88c', [7, -0.18, 2], [1.5, 0.38, 1]);
  sphere(group, 3.4, '#88a978', [5, -0.2, -7], [1.3, 0.38, 0.8]);

  cylinder(group, 0.34, 0.44, 2.8, '#806147', [-5.3, 1.15, -3.2]);
  sphere(group, 2.05, '#58845e', [-5.3, 3.35, -3.2], [1, 0.87, 1]);
  sphere(group, 1.5, '#6f9968', [-4.25, 3.15, -3.3], [0.85, 0.82, 0.9]);
  sphere(group, 1.3, '#789f6d', [-6.25, 3.2, -3], [0.8, 0.76, 0.8]);

  const bench = new THREE.Group();
  group.add(bench);
  box(bench, [2.7, 0.18, 0.72], '#a96f4e', [4.6, 0.65, -2.4]);
  box(bench, [2.7, 0.72, 0.18], '#bd805a', [4.6, 1.08, -2.67]);
  for (const x of [3.55, 5.65]) {
    cylinder(bench, 0.08, 0.1, 0.72, '#71533f', [x, 0.27, -2.42]);
    cylinder(bench, 0.08, 0.1, 0.72, '#71533f', [x, 0.27, -1.92]);
  }

  const flowerColors = ['#d97d6e', '#e5c25d', '#9c91bd', '#f0e2be'];
  for (let index = 0; index < 34; index += 1) {
    const x = Math.sin(index * 12.73) * 9;
    const z = Math.cos(index * 7.31) * 9;
    if (Math.abs(x) < 1.6 || (x > 3 && x < 6 && z > -4 && z < -1)) continue;
    const petal = flowerColors[index % flowerColors.length];
    cylinder(group, 0.035, 0.05, 0.44 + (index % 3) * 0.08, '#64845b', [x, 0.06, z]);
    sphere(group, 0.15, petal, [x, 0.42 + (index % 3) * 0.08, z], [1, 0.85, 1]);
    sphere(group, 0.055, '#e9d38a', [x, 0.44 + (index % 3) * 0.08, z], [1, 1, 1]);
  }

  const butterfly = new THREE.Group();
  const body = cylinder(butterfly, 0.045, 0.055, 0.36, '#4a574a', [0, 0, 0]);
  body.rotation.x = Math.PI / 2;
  const leftWing = sphere(butterfly, 0.18, '#d77f71', [-0.16, 0.02, 0], [1, 0.74, 0.22]);
  const rightWing = sphere(butterfly, 0.18, '#e5bd60', [0.16, 0.02, 0], [1, 0.74, 0.22]);
  leftWing.rotation.z = -0.25;
  rightWing.rotation.z = 0.25;
  group.add(butterfly);
  return {
    group,
    animate: (elapsed) => {
      butterfly.position.set(Math.sin(elapsed * 0.33) * 3.5, 1.9 + Math.sin(elapsed * 1.1) * 0.22, Math.cos(elapsed * 0.33) * 2.5 - 1);
      butterfly.rotation.y = Math.cos(elapsed * 0.33) * 0.7;
      butterfly.rotation.z = Math.sin(elapsed * 2.2) * 0.12;
    },
  };
}

function createShore(scene: THREE.Scene): EnvironmentScene {
  const group = new THREE.Group();
  scene.add(group);
  box(group, [24, 0.24, 24], '#d9c394', [0, -0.32, 0]);
  box(group, [24, 0.1, 9], '#82b8c0', [0, -0.13, 7.3], { roughness: 0.45 });
  const waveBands = [0, 1, 2].map((index) => {
    const band = box(group, [12 - index, 0.018, 0.06], '#e8f0e6', [-1 + index * 1.1, -0.055, 3.6 + index * 1.7], { roughness: 0.4 });
    return { band, baseX: -1 + index * 1.1, baseZ: 3.6 + index * 1.7 };
  });
  sphere(group, 4.4, '#ead7a9', [-7, -0.18, -4], [1.3, 0.28, 0.7]);
  sphere(group, 4.9, '#e5ce9b', [7, -0.2, -2.5], [1.5, 0.3, 0.8]);
  sphere(group, 1.3, '#f2c86e', [5.9, 7.4, -7], [1, 1, 1]);
  const sunGlow = new THREE.PointLight('#ffdda0', 26, 32);
  sunGlow.position.set(5.9, 7.4, -6);
  group.add(sunGlow);

  const palm = new THREE.Group();
  group.add(palm);
  cylinder(palm, 0.16, 0.28, 4.1, '#9d7750', [-6.5, 1.8, -3.5]);
  sphere(palm, 0.28, '#52795e', [-6.5, 3.95, -3.5]);
  for (let i = 0; i < 7; i += 1) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.22, 3.2, 8), material(i % 2 ? '#71966a' : '#5d875f'));
    leaf.position.set(-6.5 + Math.cos(i * Math.PI / 3.5) * 1.15, 4.2, -3.5 + Math.sin(i * Math.PI / 3.5) * 1.15);
    leaf.rotation.z = Math.cos(i * Math.PI / 3.5) * 0.95;
    leaf.rotation.x = Math.sin(i * Math.PI / 3.5) * 0.95;
    palm.add(leaf);
  }

  for (let i = 0; i < 8; i += 1) {
    const shell = sphere(group, 0.16, i % 2 ? '#f0e3c2' : '#d99174', [-3.8 + i * 0.9, -0.15, 1.8 + Math.sin(i * 1.7) * 0.35], [1.3, 0.45, 0.8]);
    shell.rotation.y = i * 0.7;
  }
  return {
    group,
    animate: (elapsed) => {
      waveBands.forEach(({ band, baseX, baseZ }, index) => {
        band.position.x = baseX + Math.sin(elapsed * 0.45 + index) * 0.45;
        band.position.z = baseZ + Math.cos(elapsed * 0.35 + index) * 0.12;
      });
    },
  };
}

function createSunroom(scene: THREE.Scene): EnvironmentScene {
  const group = new THREE.Group();
  scene.add(group);
  box(group, [18, 0.22, 16], '#ba9675', [0, -0.3, 0]);
  box(group, [18, 9, 0.24], '#f1e1c8', [0, 4.15, -7.9]);
  box(group, [0.24, 9, 16], '#ead9bf', [-9, 4.15, 0]);
  box(group, [0.24, 9, 16], '#ead9bf', [9, 4.15, 0]);
  box(group, [4.1, 3.4, 0.22], '#a5c6c7', [-4.8, 5, -7.7]);
  box(group, [0.18, 3.5, 0.28], '#fff1d5', [-4.8, 5, -7.5]);
  box(group, [4.2, 0.18, 0.28], '#fff1d5', [-4.8, 5, -7.5]);
  box(group, [0.16, 3.3, 0.3], '#f3e4cc', [-4.8, 5, -7.4]);
  box(group, [4, 0.16, 0.3], '#f3e4cc', [-4.8, 5, -7.4]);
  box(group, [1.2, 0.8, 0.9], '#c78c62', [4.4, 0.46, -1.5]);
  box(group, [3.8, 1, 1.7], '#8e9a82', [4.3, 0.62, -3.6]);
  box(group, [3.8, 1.25, 0.45], '#a3ae93', [4.3, 1.55, -4.2]);
  box(group, [0.18, 1.3, 0.18], '#8c654b', [2.7, 0.1, -3]);
  box(group, [0.18, 1.3, 0.18], '#8c654b', [5.9, 0.1, -3]);
  cylinder(group, 0.07, 0.08, 1.4, '#7b634d', [0, 0.4, 1.3]);
  cylinder(group, 1.05, 1.15, 0.18, '#b47d56', [0, 1.18, 1.3]);
  cylinder(group, 0.07, 0.08, 1.1, '#725a45', [-5.9, 0.35, 3.3]);
  cylinder(group, 0.8, 0.9, 0.15, '#b88660', [-5.9, 0.92, 3.3]);
  box(group, [2.2, 0.18, 0.85], '#7f6650', [-5.9, 0.82, 5.2]);
  for (let index = 0; index < 5; index += 1) {
    box(group, [0.5, 0.12, 0.42], ['#cc8e63', '#81948c', '#d7b867'][index % 3], [-6.7 + index * 0.34, 1.05, 5.2]);
  }
  sphere(group, 0.68, '#73906c', [-7.1, 0.4, -2.4], [0.8, 1.15, 0.8]);
  cylinder(group, 0.45, 0.57, 0.75, '#b88361', [-7.1, -0.06, -2.4]);
  const lightMotes = Array.from({ length: 8 }, (_item, index) => {
    const mote = sphere(group, 0.055, '#fff4d7', [-2.2 + (index % 4) * 0.7, 1.8 + Math.floor(index / 4) * 0.65, -3.5 + (index % 3) * 0.3]);
    return { mote, x: mote.position.x, y: mote.position.y, z: mote.position.z, phase: index * 0.9 };
  });
  return {
    group,
    animate: (elapsed) => {
      lightMotes.forEach(({ mote, x, y, z, phase }) => {
        mote.position.x = x + Math.sin(elapsed * 0.22 + phase) * 0.14;
        mote.position.y = y + Math.sin(elapsed * 0.42 + phase) * 0.18;
        mote.position.z = z + Math.cos(elapsed * 0.18 + phase) * 0.12;
      });
    },
  };
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((entry) => entry.dispose());
  });
}

function makeEnvironment(scene: THREE.Scene, environment: SceneName, walkMode: boolean): EnvironmentScene {
  if (environment === 'garden' && walkMode) return createGardenWalk(scene);
  if (environment === 'shore') return createShore(scene);
  if (environment === 'sunroom') return createSunroom(scene);
  return createGarden(scene);
}

export function MemorySimulation({
  patientView = false,
  hindi = false,
  guidedStory,
}: {
  patientView?: boolean;
  hindi?: boolean;
  guidedStory?: GuidedStory;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const playingRef = useRef(true);
  const walkingRef = useRef(false);
  const [environment, setEnvironment] = useState<SceneName>('garden');
  const [playing, setPlaying] = useState(true);
  const [walkMode, setWalkMode] = useState(Boolean(guidedStory));
  const [walkIntro, setWalkIntro] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [companionReply, setCompanionReply] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioError, setAudioError] = useState('');
  const [renderUnavailable, setRenderUnavailable] = useState(false);
  const question = walkQuestions[questionIndex];
  const audioLocale = hindi ? 'hi-IN' : 'en-US';

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    walkingRef.current = walkMode && playing && !guidedStory;
  }, [guidedStory, walkMode, playing]);

  useEffect(() => {
    if (!walkMode || !walkIntro) return;
    walkingRef.current = true;
    const timer = window.setTimeout(() => {
      walkingRef.current = false;
      setWalkIntro(false);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [walkMode, walkIntro]);

  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setRenderUnavailable(true);
      return;
    }

    setRenderUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    host.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(environment === 'shore' ? '#d9eced' : environment === 'sunroom' ? '#eadfcf' : '#dce8d5');
    scene.fog = new THREE.Fog(scene.background, 16, 38);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(12, 9, 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 7;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();

    const ambient = new THREE.HemisphereLight('#fff9e8', '#78916d', 2.2);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight(environment === 'sunroom' ? '#ffe0ae' : '#fff0c5', 3.1);
    sunlight.position.set(-7, 13, 7);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -16;
    sunlight.shadow.camera.right = 16;
    sunlight.shadow.camera.top = 16;
    sunlight.shadow.camera.bottom = -16;
    scene.add(sunlight);

    const environmentScene = makeEnvironment(scene, environment, walkMode);
    const followOffset = new THREE.Vector3(4.5, 4.2, 8);
    if (walkMode && environmentScene.walker) {
      controls.enabled = false;
        controls.target.set(environmentScene.walker.position.x, 1.25, environmentScene.walker.position.z + 2.3);
      camera.position.copy(controls.target).add(followOffset);
      controls.update();
    }

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(host);

    let frame = 0;
    let elapsed = 0;
    let previous = 0;
    const render = (time: number) => {
      frame = window.requestAnimationFrame(render);
      const delta = Math.min((time - previous) / 1000, 0.05);
      previous = time;
      if (playingRef.current) elapsed += delta;
      if (playingRef.current) environmentScene.animate(elapsed);
      if (environmentScene.walker && environmentScene.walking) {
        environmentScene.walking(elapsed, delta, walkingRef.current && playingRef.current);
        controls.target.set(environmentScene.walker.position.x, 1.25, environmentScene.walker.position.z + 2.3);
        camera.position.copy(controls.target).add(followOffset);
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      controls.dispose();
      controlsRef.current = null;
      disposeObject(environmentScene.group);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [environment, walkMode]);

  const selected = environments.find((item) => item.id === environment)!;
  const translatedNames: Record<SceneName, string> = {
    garden: 'बगीचे की सैर',
    shore: 'समुद्र किनारे',
    sunroom: 'धूप वाला कमरा',
  };

  function startGardenWalk() {
    setEnvironment('garden');
    setQuestionIndex(0);
    setCompanionReply('');
    setAudioError('');
    setPlaying(true);
    setWalkMode(true);
    setWalkIntro(true);
    walkingRef.current = true;
  }

  function stopGardenWalk() {
    window.speechSynthesis?.cancel();
    walkingRef.current = false;
    setWalkMode(false);
    setWalkIntro(false);
    setCompanionReply('');
  }

  function chooseAnswer(choice: WalkQuestion['choices'][number]) {
    walkingRef.current = false;
    setCompanionReply(hindi ? choice.hindiReply : choice.reply);
  }

  function speakCompanionLine(line: string) {
    if (!('speechSynthesis' in window)) {
      setAudioError(hindi
        ? 'इस ब्राउज़र में आवाज़ उपलब्ध नहीं है। आप स्क्रीन पर बातचीत पढ़ सकते हैं।'
        : 'Voice playback is not available in this browser. You can read the conversation on screen.');
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((item) =>
      item.lang.toLowerCase().replace('_', '-') === audioLocale.toLowerCase())
      ?? voices.find((item) =>
        item.lang.toLowerCase().replace('_', '-').split('-')[0] === audioLocale.split('-')[0]);
    if (!voice) {
      setAudioError(hindi
        ? 'हिंदी आवाज़ इस डिवाइस पर उपलब्ध नहीं है। आप बातचीत पढ़ सकते हैं।'
        : 'An English voice is not available on this device. You can read the conversation on screen.');
      return;
    }
    setAudioError('');
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = voice.lang;
    utterance.voice = voice;
    utterance.rate = 0.86;
    window.speechSynthesis.speak(utterance);
  }

  function continueWalk() {
    window.speechSynthesis?.cancel();
    setCompanionReply('');
    setWalkIntro(true);
    walkingRef.current = true;
    if (questionIndex >= walkQuestions.length - 1) {
      setQuestionIndex(0);
    } else {
      setQuestionIndex((current) => current + 1);
    }
    walkingRef.current = false;
  }

  useEffect(() => {
    if (!audioEnabled || !walkMode) return;
    if (guidedStory) {
      const answer = guidedStory.answerOptions[guidedStory.selectedIndex];
      const line = answer === undefined
        ? guidedStory.question
        : answer === guidedStory.expectedAnswer
          ? (hindi ? `बिल्कुल सही। ${guidedStory.expectedAnswer} याद रखने का अच्छा तरीका है।` : `That’s right. ${guidedStory.expectedAnswer} is a lovely detail to remember.`)
          : (hindi ? `अच्छी कोशिश। इस कहानी में जवाब है ${guidedStory.expectedAnswer}।` : `Thank you for thinking about it. In this story, the answer is ${guidedStory.expectedAnswer}.`);
      speakCompanionLine(line);
      return;
    }
    const line = walkIntro
      ? (hindi ? 'आइए, बगीचे में धीरे-धीरे साथ चलते हैं।' : 'Let’s take a gentle stroll together.')
      : companionReply || (hindi ? question.hindiQuestion : question.question);
    speakCompanionLine(line);
  }, [audioEnabled, companionReply, guidedStory, hindi, question.hindiQuestion, question.question, walkIntro, walkMode]);

  const guidedAnswer = guidedStory?.answerOptions[guidedStory.selectedIndex];
  const guidedFeedback = guidedStory && guidedAnswer !== undefined
    ? guidedAnswer === guidedStory.expectedAnswer
      ? (hindi ? `बिल्कुल सही। ${guidedStory.expectedAnswer} याद रखने का अच्छा तरीका है।` : `That’s right. ${guidedStory.expectedAnswer} is a lovely detail to remember.`)
      : (hindi ? `अच्छी कोशिश। इस कहानी में जवाब है ${guidedStory.expectedAnswer}।` : `Thank you for thinking about it. In this story, the answer is ${guidedStory.expectedAnswer}.`)
    : '';

  return (
    <section className={patientView ? 'simulation-card patient-simulation' : 'simulation-card'}>
      <header className="simulation-heading">
        <div>
          <p className="eyebrow">{patientView ? (hindi ? 'आपके लिए एक शांत दृश्य' : 'A quiet scene for you') : 'Explore a 3D scene'}</p>
          <h2>{guidedStory ? (hindi ? 'मीरा के साथ कहानी' : 'Your story with Mira') : patientView ? (hindi ? '3D जगहें' : '3D places') : 'Memory garden studio'}</h2>
          <p>{patientView
            ? guidedStory
              ? (hindi ? 'मीरा आपके डॉक्टर की कहानी से एक सवाल पूछेंगी। आराम से जवाब दें।' : 'Mira will ask a question from your doctor’s story. Take your time to answer.')
              : (hindi ? 'एक जगह चुनें। दृश्य को धीरे से घुमाकर देखें।' : 'Choose a place and look around at your own pace.')
            : 'Preview calm, familiar environments. Drag to look around; use the controls to turn or zoom.'}</p>
        </div>
        {!patientView && <span className="simulation-badge">THREE.JS · INTERACTIVE</span>}
      </header>

      {!walkMode && <div className="environment-picker" role="group" aria-label={hindi ? '3D जगह चुनें' : 'Choose a 3D environment'}>
        {environments.map((item) => <button
          key={item.id}
          className={environment === item.id ? 'environment-option selected' : 'environment-option'}
          onClick={() => setEnvironment(item.id)}
          aria-pressed={environment === item.id}
        >
          <span className="environment-swatch" style={{ backgroundColor: item.color }} />
          <span>{hindi ? translatedNames[item.id] : item.title}</span>
        </button>)}
      </div>}

      <div className="simulation-viewport">
        <div ref={canvasHost} className="simulation-canvas" aria-label={hindi ? 'इंटरैक्टिव 3D दृश्य' : 'Interactive Three.js scene'} />
        {renderUnavailable && walkMode
          ? <div className="simulation-walk-fallback" role="img" aria-label={hindi ? 'बगीचे में साथ टहलते कार्टून साथी' : 'Cartoon companion walking together in a garden'}>
            <span className="fallback-tree fallback-tree-left">🌳</span>
            <span className="fallback-tree fallback-tree-right">🌳</span>
            <span className="fallback-flower fallback-flower-one">🌼</span>
            <span className="fallback-flower fallback-flower-two">🌷</span>
            <span className="fallback-walk-path" />
            <span className="fallback-companion" aria-hidden="true">
              <svg viewBox="0 0 100 154">
                <ellipse cx="50" cy="147" rx="24" ry="5" fill="#738360" opacity=".28" />
                <path className="fallback-leg fallback-leg-left" d="M43 108 39 132" stroke="#607e79" strokeWidth="9" strokeLinecap="round" />
                <path className="fallback-leg fallback-leg-right" d="M57 108 61 132" stroke="#607e79" strokeWidth="9" strokeLinecap="round" />
                <path d="M36 132h-7m7 0 4 3m20-3h7m-7 0-4 3" stroke="#765d4b" strokeWidth="7" strokeLinecap="round" />
                <path d="M37 62q13-11 26 0l10 49H27Z" fill="#df9273" />
                <path className="fallback-arm fallback-arm-left" d="m36 68-10 24" stroke="#df9273" strokeWidth="9" strokeLinecap="round" />
                <path className="fallback-arm fallback-arm-right" d="m64 68 10 24" stroke="#df9273" strokeWidth="9" strokeLinecap="round" />
                <circle cx="50" cy="39" r="22" fill="#efc39d" />
                <path d="M29 40q-2-26 21-27 22 1 22 25l-8-9-7 4-10-7-10 10Z" fill="#71665c" />
                <circle cx="43" cy="42" r="2" fill="#453c38" />
                <circle cx="57" cy="42" r="2" fill="#453c38" />
                <path d="M44 51q6 6 12 0" fill="none" stroke="#8b514b" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M20 19q30-14 60 0l-4 5H24Z" fill="#eac978" />
                <path d="M38 18q1-13 12-13t12 13" fill="#eac978" />
              </svg>
            </span>
            <span className="fallback-sun" aria-hidden="true">☀️</span>
          </div>
          : renderUnavailable
          ? <div className="simulation-fallback" role="status"><span aria-hidden="true">◌</span><p>{hindi
            ? 'इस डिवाइस पर 3D दृश्य उपलब्ध नहीं है। आप अन्य कहानियाँ उपयोग कर सकते हैं।'
            : '3D is not available in this browser or device. You can still use the rest of Memoria.'}</p></div>
          : <span className="simulation-scene-label">{hindi ? translatedNames[environment] : selected.title}</span>}
      </div>

      {!walkMode ? <div className="simulation-controls">
        <p>{hindi ? (environment === 'garden' ? 'फूलों के बीच धूप वाला रास्ता और एक शांत बेंच।' : environment === 'shore' ? 'रेत के टीले, नीला पानी और गर्म दोपहर की धूप।' : 'आरामदायक कुर्सी, छोटी मेज़ और रोशनी से भरी खिड़की।') : selected.description}</p>
        {!renderUnavailable && <div className="simulation-actions">
          <button className="button button-secondary" onClick={() => controlsRef.current?.rotateLeft(Math.PI / 5)} aria-label={hindi ? 'दृश्य बाईं ओर घुमाएँ' : 'Turn scene left'}>↶ <span>{hindi ? 'बाएँ' : 'Turn left'}</span></button>
          <button className="button button-secondary" onClick={() => controlsRef.current?.rotateLeft(-Math.PI / 5)} aria-label={hindi ? 'दृश्य दाईं ओर घुमाएँ' : 'Turn scene right'}>↷ <span>{hindi ? 'दाएँ' : 'Turn right'}</span></button>
          <button className="button button-secondary" onClick={() => setPlaying((value) => !value)} aria-pressed={playing}>
            {playing ? 'Ⅱ' : '▶'} <span>{hindi ? (playing ? 'रोकें' : 'चलाएँ') : (playing ? 'Pause motion' : 'Resume motion')}</span>
          </button>
        </div>}
        <small>{hindi ? 'इस दृश्य का उपयोग आराम और अन्वेषण के लिए है; यह चिकित्सा उपचार नहीं है।' : 'For calm exploration only. This scene is not a medical treatment.'}</small>
        {environment === 'garden' && <button className="button button-primary start-garden-walk" onClick={startGardenWalk}>{hindi ? 'साथ में सैर शुरू करें' : 'Start a garden walk together'} <span aria-hidden="true">→</span></button>}
      </div> : guidedStory ? <section className="garden-conversation guided-story-conversation" aria-label={hindi ? 'मीरा के साथ कहानी' : 'Story with Mira'}>
        <div className="companion-intro">
          <span className="companion-avatar" aria-hidden="true">☺</span>
          <div><b>{hindi ? 'मीरा' : 'Mira'}</b><small>{hindi ? 'आपकी कहानी की साथी' : 'Your story companion'}</small></div>
          <button className="text-button companion-audio-toggle" aria-pressed={audioEnabled} onClick={() => {
            setAudioEnabled((enabled) => {
              if (enabled) window.speechSynthesis?.cancel();
              return !enabled;
            });
            setAudioError('');
          }}>{audioEnabled ? (hindi ? 'आवाज़ बंद करें' : 'Turn voice off') : (hindi ? 'आवाज़ चालू करें' : 'Turn voice on')}</button>
        </div>
        <div className="companion-dialogue" aria-live="polite">
          <p className="dialogue-caption">{guidedAnswer === undefined ? (hindi ? 'मीरा पूछती हैं' : 'Mira asks') : (hindi ? 'मिलकर याद करें' : 'Let’s remember together')}</p>
          <h3>{guidedAnswer === undefined ? guidedStory.question : guidedFeedback}</h3>
          {guidedAnswer === undefined && <p className="companion-waiting">{hindi ? 'आराम से सोचें। मैं यहीं आपके साथ इंतज़ार करूँगी।' : 'Take your time. I’ll wait right here with you.'}</p>}
        </div>
        {guidedAnswer === undefined ? <div className="conversation-choices">
          {guidedStory.answerOptions.map((option, index) => <button key={`${index}-${option}`} className="conversation-choice" onClick={() => guidedStory.onChoose(index)}>
            <span aria-hidden="true">♡</span>{option}<span className="choice-chevron" aria-hidden="true">›</span>
          </button>)}
        </div> : <div className="conversation-actions">
          <button className="button button-primary" disabled={guidedStory.busy} onClick={guidedStory.onContinue}>{guidedStory.continueLabel} <span aria-hidden="true">→</span></button>
        </div>}
        {audioEnabled && <button className="button button-secondary dialogue-listen" onClick={() => speakCompanionLine(guidedAnswer === undefined ? guidedStory.question : guidedFeedback)}>
          ♫ <span>{hindi ? 'मीरा को सुनें' : 'Listen to Mira'}</span>
        </button>}
        {audioError && <p className="simulation-audio-error" role="status">{audioError}</p>}
        <small className="conversation-footnote">{hindi
          ? 'सीखने का एक शांत तरीका। कोई जल्दी नहीं है।'
          : 'A gentle way to learn together. There is no hurry.'}</small>
      </section> : <section className="garden-conversation" aria-label={hindi ? 'बगीचे में बातचीत' : 'Garden walk conversation'}>
        <div className="companion-intro">
          <span className="companion-avatar" aria-hidden="true">☺</span>
          <div><b>{hindi ? 'मीरा' : 'Mira'}</b><small>{hindi ? 'आपकी बगीचे की साथी' : 'Your garden companion'}</small></div>
          <button className="text-button companion-audio-toggle" aria-pressed={audioEnabled} onClick={() => {
            setAudioEnabled((enabled) => {
              if (enabled) window.speechSynthesis?.cancel();
              return !enabled;
            });
            setAudioError('');
          }}>{audioEnabled ? (hindi ? 'आवाज़ बंद करें' : 'Turn voice off') : (hindi ? 'आवाज़ चालू करें' : 'Turn voice on')}</button>
        </div>
        <div className="companion-dialogue" aria-live="polite">
          {walkIntro
            ? <><p className="dialogue-caption">{hindi ? 'मीरा कहती हैं' : 'Mira says'}</p>
              <h3>{hindi ? 'आइए, बगीचे में धीरे-धीरे साथ चलते हैं।' : 'Let’s take a gentle stroll together.'}</h3>
              <p className="companion-waiting">{hindi ? 'हम फूलों वाले रास्ते पर चल रहे हैं…' : 'We’re walking along the flower path…'}</p></>
            : <><p className="dialogue-caption">{hindi ? 'मीरा पूछती हैं' : 'Mira asks'}</p>
              <h3>{hindi ? question.hindiQuestion : question.question}</h3>
              {!companionReply ? <p className="companion-waiting">{hindi
                ? 'आराम से सोचें। मैं यहीं आपके साथ इंतज़ार करूँगी।'
                : 'Take your time. I’ll wait right here with you.'}</p> : <p className="companion-reply"><b>{hindi ? 'मीरा कहती हैं' : 'Mira says'}</b>{companionReply}</p>}</>}
        </div>
        {walkIntro ? <div className="companion-waiting walk-intro" role="status">
          <span className="walking-dots" aria-hidden="true">•••</span>
          <p>{hindi ? 'आइए, बगीचे में धीरे-धीरे साथ चलते हैं…' : 'Let’s take a gentle stroll together…'}</p>
        </div> : !companionReply ? <div className="conversation-choices">
          {question.choices.map((choice) => <button key={choice.label} className="conversation-choice" onClick={() => chooseAnswer(choice)}>
            <span aria-hidden="true">♡</span>{hindi ? choice.hindiLabel : choice.label}<span className="choice-chevron" aria-hidden="true">›</span>
          </button>)}
        </div> : <div className="conversation-actions">
          <button className="button button-primary" onClick={continueWalk}>{questionIndex >= walkQuestions.length - 1
            ? (hindi ? 'एक और सैर करें' : 'Take another stroll')
            : (hindi ? 'आगे चलें' : 'Continue our walk')} <span aria-hidden="true">→</span></button>
          <button className="button button-secondary" onClick={stopGardenWalk}>{hindi ? 'सैर पूरी करें' : 'Finish stroll'}</button>
        </div>}
        {audioEnabled && <button className="button button-secondary dialogue-listen" onClick={() => speakCompanionLine(walkIntro
          ? (hindi ? 'आइए, बगीचे में धीरे-धीरे साथ चलते हैं।' : 'Let’s take a gentle stroll together.')
          : companionReply || (hindi ? question.hindiQuestion : question.question))}>
          ♫ <span>{hindi ? 'मीरा को सुनें' : 'Listen to Mira'}</span>
        </button>}
        {audioError && <p className="simulation-audio-error" role="status">{audioError}</p>}
        <button className="walk-exit-button" onClick={stopGardenWalk}>{hindi ? 'सैर रोकें और बाहर जाएँ' : 'End the stroll and leave'}</button>
        <small className="conversation-footnote">{hindi
          ? 'यह एक शांत, पसंद-आधारित बातचीत है। कोई सही या गलत जवाब नहीं है।'
          : 'A gentle, choice-based chat. There are no right or wrong answers.'}</small>
      </section>}
    </section>
  );
}
