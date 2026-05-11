"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function OceanBackground() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x001a2e, 0.014);

        // Fixed camera — never moves
        const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 300);
        camera.position.set(0, 0, 30);
        camera.lookAt(0, 0, 0);

        // ── Static ocean gradient background ─────────────────────────────────
        const bgGeom = new THREE.PlaneGeometry(300, 300);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                void main(){
                    vec3 deep = vec3(0.0, 0.03, 0.10);
                    vec3 mid  = vec3(0.0, 0.10, 0.26);
                    vec3 surf = vec3(0.0, 0.20, 0.42);
                    float t = vUv.y;
                    vec3 col = mix(deep, mix(mid, surf, t * t), t);
                    // subtle caustic shimmer — very gentle, not moving
                    float shimmer = sin(vUv.x * 22.0 + uTime * 0.25) * sin(vUv.y * 14.0 + uTime * 0.18) * 0.018;
                    gl_FragColor = vec4(col + shimmer, 1.0);
                }
            `,
            side: THREE.FrontSide,
        });
        const bg = new THREE.Mesh(bgGeom, bgMat);
        bg.position.z = -60;
        scene.add(bg);

        // ── Static god rays ───────────────────────────────────────────────────
        for (let i = 0; i < 10; i++) {
            const h = THREE.MathUtils.randFloat(20, 38);
            const geom = new THREE.CylinderGeometry(0.04, THREE.MathUtils.randFloat(1.2, 3.0), h, 6, 1, true);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x66ccff,
                transparent: true,
                opacity: THREE.MathUtils.randFloat(0.025, 0.07),
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const ray = new THREE.Mesh(geom, mat);
            ray.position.set(
                THREE.MathUtils.randFloatSpread(50),
                h / 2 + 6,
                THREE.MathUtils.randFloat(-18, -6),
            );
            ray.rotation.z = THREE.MathUtils.randFloatSpread(0.25);
            scene.add(ray);
        }

        // ── Bubble particles ──────────────────────────────────────────────────
        const BUBBLE_COUNT = 500;
        const bPos = new Float32Array(BUBBLE_COUNT * 3);
        const bSpeeds = new Float32Array(BUBBLE_COUNT);
        for (let i = 0; i < BUBBLE_COUNT; i++) {
            bPos[i * 3]     = THREE.MathUtils.randFloatSpread(80);
            bPos[i * 3 + 1] = THREE.MathUtils.randFloatSpread(60) - 10;
            bPos[i * 3 + 2] = THREE.MathUtils.randFloatSpread(30) - 20;
            bSpeeds[i] = THREE.MathUtils.randFloat(0.3, 1.2);
        }
        const bubbleGeom = new THREE.BufferGeometry();
        bubbleGeom.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
        const bubbleMat = new THREE.PointsMaterial({
            color: 0xaaddff, size: 0.2, transparent: true, opacity: 0.45,
            sizeAttenuation: true, depthWrite: false,
        });
        scene.add(new THREE.Points(bubbleGeom, bubbleMat));

        // ── Whale builder ─────────────────────────────────────────────────────
        function buildWhale(): THREE.Group {
            const g = new THREE.Group();
            const skin  = new THREE.MeshPhongMaterial({ color: 0x1e3d5a, shininess: 50, specular: 0x1a3355 });
            const belly = new THREE.MeshPhongMaterial({ color: 0x7aaabf, shininess: 15 });

            // Body
            const bodyG = new THREE.SphereGeometry(1, 36, 24);
            const bp = bodyG.attributes.position;
            for (let i = 0; i < bp.count; i++) {
                const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
                bp.setXYZ(i, x * 4.8 + (x > 0 ? x * 0.45 : x * 0.25), y * (x > 1 ? 0.68 : 1.0), z * 1.25);
            }
            bodyG.computeVertexNormals();
            g.add(new THREE.Mesh(bodyG, skin));

            // Belly patch
            const bellyG = new THREE.SphereGeometry(0.93, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
            const bellyP = bellyG.attributes.position;
            for (let i = 0; i < bellyP.count; i++) {
                bellyG.attributes.position.setXYZ(i,
                    bellyP.getX(i) * 4.1,
                    bellyP.getY(i) * 0.48 - 0.52,
                    bellyP.getZ(i) * 1.05,
                );
            }
            bellyG.computeVertexNormals();
            g.add(new THREE.Mesh(bellyG, belly));

            // Rostrum / head
            const headM = new THREE.Mesh(new THREE.SphereGeometry(0.68, 20, 16), skin);
            headM.position.set(4.9, 0.1, 0);
            headM.scale.set(1.25, 0.65, 0.85);
            g.add(headM);

            // Tail stock (child[3])
            const tsGeom = new THREE.CylinderGeometry(0.22, 0.68, 4.2, 20);
            const tailStock = new THREE.Mesh(tsGeom, skin);
            tailStock.rotation.z = Math.PI / 2;
            tailStock.position.set(-5.6, 0, 0);
            g.add(tailStock); // index 3

            // Fluke top (child[4])
            const flukeShape = new THREE.Shape();
            flukeShape.moveTo(0, 0);
            flukeShape.bezierCurveTo(0.8, 2.6, 2.8, 3.0, 3.6, 1.6);
            flukeShape.bezierCurveTo(3.9, 0.4, 2.2, -0.4, 0, 0);
            const flukeOpts = { depth: 0.11, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 };
            const flukeG = new THREE.ExtrudeGeometry(flukeShape, flukeOpts);

            const flukeTop = new THREE.Mesh(flukeG, skin);
            flukeTop.position.set(-7.4, 0, 0.06);
            flukeTop.rotation.set(0, Math.PI / 2, -0.18);
            flukeTop.scale.setScalar(0.82);
            g.add(flukeTop); // index 4

            const flukeBot = new THREE.Mesh(flukeG, skin);
            flukeBot.position.set(-7.4, 0, -0.06);
            flukeBot.rotation.set(Math.PI, Math.PI / 2, 0.18);
            flukeBot.scale.setScalar(0.82);
            g.add(flukeBot); // index 5

            // Pec fin L (child[6])
            const pectShape = new THREE.Shape();
            pectShape.moveTo(0, 0);
            pectShape.bezierCurveTo(1.2, 0.6, 4.2, 0.9, 5.6, 0.2);
            pectShape.bezierCurveTo(4.5, -0.15, 1.4, -0.55, 0, 0);
            const pectG = new THREE.ExtrudeGeometry(pectShape, { depth: 0.07, bevelEnabled: false });

            const finL = new THREE.Mesh(pectG, skin);
            finL.position.set(1.8, -0.85, 1.3);
            finL.rotation.set(-0.38, 0.28, 0.52);
            finL.scale.setScalar(0.88);
            g.add(finL); // index 6

            const finR = finL.clone();
            finR.position.set(1.8, -0.85, -1.3);
            finR.rotation.set(0.38, -0.28, 0.52);
            g.add(finR); // index 7

            // Dorsal fin
            const dorsShape = new THREE.Shape();
            dorsShape.moveTo(0, 0);
            dorsShape.bezierCurveTo(0.4, 1.3, 1.6, 1.6, 2.1, 0.85);
            dorsShape.bezierCurveTo(1.6, 0.2, 0.5, 0, 0, 0);
            const dorsM = new THREE.Mesh(new THREE.ExtrudeGeometry(dorsShape, { depth: 0.07, bevelEnabled: false }), skin);
            dorsM.position.set(-1.6, 1.05, -0.035);
            g.add(dorsM);

            // Eye
            const eyeM = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 10, 8),
                new THREE.MeshPhongMaterial({ color: 0x060606, shininess: 120, specular: 0x555555 }),
            );
            eyeM.position.set(3.9, 0.32, 1.08);
            g.add(eyeM);
            const eyeR2 = eyeM.clone();
            eyeR2.position.z = -1.08;
            g.add(eyeR2);

            return g;
        }

        const whale = buildWhale();
        whale.scale.setScalar(1.25);
        scene.add(whale);

        // ── Lighting ──────────────────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0x002255, 1.4));
        const sun = new THREE.DirectionalLight(0x88ccff, 2.0);
        sun.position.set(8, 28, 6);
        scene.add(sun);
        const fill = new THREE.PointLight(0x003388, 1.1, 70);
        fill.position.set(-12, 4, 12);
        scene.add(fill);
        const rim = new THREE.PointLight(0x0099cc, 0.7, 45);
        rim.position.set(2, -10, 18);
        scene.add(rim);

        // ── Resize ────────────────────────────────────────────────────────────
        const onResize = () => {
            if (!mount) return;
            camera.aspect = mount.clientWidth / mount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", onResize);

        // ── Animation loop ────────────────────────────────────────────────────
        let frame = 0;
        const clock = new THREE.Clock();
        const bPosArr = bubbleGeom.attributes.position.array as Float32Array;

        // Whale swim constants
        const SWIM_SPEED = 0.28;   // units/sec
        const X_START    = 60;     // enters from right
        const X_END      = -58;    // exits to left
        const SWIM_RANGE = X_START - X_END;
        const DEPTH      = -4;     // z position of whale

        const animate = () => {
            frame = requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            bgMat.uniforms.uTime.value = t;

            // ── Whale position: smooth cyclic loop ────────────────────────────
            const progress = (t * SWIM_SPEED) % SWIM_RANGE;
            whale.position.x = X_START - progress;
            whale.position.z = DEPTH;

            // Natural vertical undulation (sine wave path)
            const bobCycle = t * 0.38;
            whale.position.y = Math.sin(bobCycle) * 1.8;

            // Body tilt follows the vertical path (pitches with the sine)
            whale.rotation.z = Math.cos(bobCycle) * 0.055;

            // Slight heading yaw — gentle weave
            whale.rotation.y = -0.25 + Math.sin(t * 0.18) * 0.06;

            // ── Tail undulation (drives from the stock outward) ───────────────
            const tailFreq = t * 1.6;
            const tailAmp  = 0.32;
            const tailStock = whale.children[3] as THREE.Mesh;
            if (tailStock) tailStock.rotation.y = Math.sin(tailFreq) * tailAmp;

            const flukeTop = whale.children[4] as THREE.Mesh;
            if (flukeTop) flukeTop.rotation.z = Math.sin(tailFreq + 0.4) * 0.22 - 0.18;
            const flukeBot = whale.children[5] as THREE.Mesh;
            if (flukeBot) flukeBot.rotation.z = Math.sin(tailFreq + 0.4) * 0.22 + 0.18;

            // ── Pectoral fin gentle sweep ─────────────────────────────────────
            const finL = whale.children[6] as THREE.Mesh;
            if (finL) finL.rotation.z = 0.52 + Math.sin(t * 0.7) * 0.09;
            const finR = whale.children[7] as THREE.Mesh;
            if (finR) finR.rotation.z = 0.52 + Math.sin(t * 0.7 + 0.6) * 0.09;

            // ── Bubbles rise ──────────────────────────────────────────────────
            for (let i = 0; i < BUBBLE_COUNT; i++) {
                bPosArr[i * 3 + 1] += bSpeeds[i] * 0.012;
                bPosArr[i * 3]     += Math.sin(t * 0.4 + i) * 0.002;
                if (bPosArr[i * 3 + 1] > 32) {
                    bPosArr[i * 3 + 1] = -25;
                    bPosArr[i * 3]     = THREE.MathUtils.randFloatSpread(80);
                }
            }
            bubbleGeom.attributes.position.needsUpdate = true;

            renderer.render(scene, camera);
        };
        animate();

        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", onResize);
            renderer.dispose();
            if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
        };
    }, []);

    return <div ref={mountRef} className="absolute inset-0 w-full h-full" />;
}
