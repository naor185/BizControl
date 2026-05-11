"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function OceanBackground() {
    const mountRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        // ── Renderer ─────────────────────────────────────────────────────────
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.shadowMap.enabled = true;
        mount.appendChild(renderer.domElement);

        // ── Scene & Camera ───────────────────────────────────────────────────
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x001a2e, 0.018);

        const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 300);
        camera.position.set(0, 0, 28);

        // ── Ocean Background Gradient ─────────────────────────────────────────
        const bgGeom = new THREE.PlaneGeometry(300, 300);
        const bgMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
            fragmentShader: `
                uniform float uTime;
                varying vec2 vUv;
                void main(){
                    vec3 deep   = vec3(0.0, 0.04, 0.12);
                    vec3 mid    = vec3(0.0, 0.13, 0.30);
                    vec3 top    = vec3(0.0, 0.22, 0.45);
                    float t = vUv.y;
                    vec3 col = mix(deep, mix(mid,top,t*t), t);
                    float shimmer = sin(vUv.x*18.0+uTime*0.4)*sin(vUv.y*12.0+uTime*0.3)*0.03;
                    gl_FragColor = vec4(col+shimmer, 1.0);
                }
            `,
            side: THREE.FrontSide,
        });
        const bg = new THREE.Mesh(bgGeom, bgMat);
        bg.position.z = -60;
        scene.add(bg);

        // ── Caustics / God Rays ───────────────────────────────────────────────
        const rayCount = 12;
        const rays: THREE.Mesh[] = [];
        for (let i = 0; i < rayCount; i++) {
            const h = THREE.MathUtils.randFloat(18, 35);
            const geom = new THREE.CylinderGeometry(0.05, THREE.MathUtils.randFloat(1.5, 3.5), h, 6, 1, true);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x88ddff,
                transparent: true,
                opacity: THREE.MathUtils.randFloat(0.03, 0.09),
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const ray = new THREE.Mesh(geom, mat);
            ray.position.set(
                THREE.MathUtils.randFloatSpread(40),
                h / 2 + 8,
                THREE.MathUtils.randFloat(20) - 10,
            );
            ray.rotation.z = THREE.MathUtils.randFloatSpread(0.3);
            ray.userData = {
                speed: THREE.MathUtils.randFloat(0.3, 0.9),
                phase: Math.random() * Math.PI * 2,
                baseOpacity: (mat as THREE.MeshBasicMaterial).opacity,
            };
            rays.push(ray);
            scene.add(ray);
        }

        // ── Bubble Particles ─────────────────────────────────────────────────
        const BUBBLE_COUNT = 600;
        const bPos = new Float32Array(BUBBLE_COUNT * 3);
        const bSizes = new Float32Array(BUBBLE_COUNT);
        const bSpeeds = new Float32Array(BUBBLE_COUNT);
        for (let i = 0; i < BUBBLE_COUNT; i++) {
            bPos[i * 3]     = THREE.MathUtils.randFloatSpread(80);
            bPos[i * 3 + 1] = THREE.MathUtils.randFloatSpread(50) - 10;
            bPos[i * 3 + 2] = THREE.MathUtils.randFloatSpread(30) - 20;
            bSizes[i]  = THREE.MathUtils.randFloat(1.5, 5);
            bSpeeds[i] = THREE.MathUtils.randFloat(0.4, 1.4);
        }
        const bubbleGeom = new THREE.BufferGeometry();
        bubbleGeom.setAttribute("position", new THREE.BufferAttribute(bPos, 3));
        bubbleGeom.setAttribute("size", new THREE.BufferAttribute(bSizes, 1));
        const bubbleMat = new THREE.PointsMaterial({
            color: 0xaaddff,
            size: 0.25,
            transparent: true,
            opacity: 0.5,
            sizeAttenuation: true,
            depthWrite: false,
        });
        const bubbles = new THREE.Points(bubbleGeom, bubbleMat);
        scene.add(bubbles);

        // ── Whale Body Builder ────────────────────────────────────────────────
        function buildWhale(): THREE.Group {
            const whale = new THREE.Group();
            const skinColor = 0x2a4a6b;
            const bellyColor = 0x8ab4c8;

            const skin = new THREE.MeshPhongMaterial({ color: skinColor, shininess: 40, specular: 0x224466 });
            const belly = new THREE.MeshPhongMaterial({ color: bellyColor, shininess: 20 });

            // Body
            const bodyGeom = new THREE.SphereGeometry(1, 32, 24);
            const bodyPos = bodyGeom.attributes.position;
            for (let i = 0; i < bodyPos.count; i++) {
                const x = bodyPos.getX(i), y = bodyPos.getY(i), z = bodyPos.getZ(i);
                bodyPos.setXYZ(i,
                    x * 4.5 + (x > 0 ? x * 0.5 : x * 0.3),
                    y * (x > 1 ? 0.7 : 1.0),
                    z * 1.3
                );
            }
            bodyGeom.computeVertexNormals();
            const body = new THREE.Mesh(bodyGeom, skin);
            whale.add(body);

            // Belly patch
            const bellyGeom = new THREE.SphereGeometry(0.95, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
            for (let i = 0; i < bellyGeom.attributes.position.count; i++) {
                const x = bellyGeom.attributes.position.getX(i);
                const z = bellyGeom.attributes.position.getZ(i);
                bellyGeom.attributes.position.setXYZ(i,
                    x * 4.2, bellyGeom.attributes.position.getY(i) * 0.5 - 0.55, z * 1.1
                );
            }
            bellyGeom.computeVertexNormals();
            const bellyMesh = new THREE.Mesh(bellyGeom, belly);
            whale.add(bellyMesh);

            // Head bump (rostrum)
            const headGeom = new THREE.SphereGeometry(0.7, 20, 16);
            const headMesh = new THREE.Mesh(headGeom, skin);
            headMesh.position.set(4.8, 0.1, 0);
            headMesh.scale.set(1.3, 0.7, 0.9);
            whale.add(headMesh);

            // Tail stock
            const tailGeom = new THREE.CylinderGeometry(0.25, 0.7, 4, 20);
            const tailStock = new THREE.Mesh(tailGeom, skin);
            tailStock.rotation.z = Math.PI / 2;
            tailStock.position.set(-5.5, 0, 0);
            whale.add(tailStock);

            // Tail flukes
            const flukeShape = new THREE.Shape();
            flukeShape.moveTo(0, 0);
            flukeShape.bezierCurveTo(1, 2.5, 3, 2.8, 3.5, 1.5);
            flukeShape.bezierCurveTo(3.8, 0.5, 2, -0.3, 0, 0);
            const flukeSettings = { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05 };
            const flukeGeom = new THREE.ExtrudeGeometry(flukeShape, flukeSettings);

            const flukeTop = new THREE.Mesh(flukeGeom, skin);
            flukeTop.position.set(-7.2, 0, 0.06);
            flukeTop.rotation.set(0, Math.PI / 2, -0.2);
            flukeTop.scale.set(0.85, 0.85, 0.85);
            whale.add(flukeTop);

            const flukeBot = new THREE.Mesh(flukeGeom, skin);
            flukeBot.position.set(-7.2, 0, -0.06);
            flukeBot.rotation.set(Math.PI, Math.PI / 2, 0.2);
            flukeBot.scale.set(0.85, 0.85, 0.85);
            whale.add(flukeBot);

            // Pectoral fins (long — humpback signature)
            const pectShape = new THREE.Shape();
            pectShape.moveTo(0, 0);
            pectShape.bezierCurveTo(1, 0.5, 4, 0.8, 5.5, 0.2);
            pectShape.bezierCurveTo(4.5, -0.1, 1.5, -0.5, 0, 0);
            const pectGeom = new THREE.ExtrudeGeometry(pectShape, { depth: 0.08, bevelEnabled: false });

            const finL = new THREE.Mesh(pectGeom, skin);
            finL.position.set(2, -0.8, 1.25);
            finL.rotation.set(-0.4, 0.3, 0.5);
            finL.scale.set(0.9, 0.9, 0.9);
            whale.add(finL);

            const finR = finL.clone();
            finR.position.set(2, -0.8, -1.25);
            finR.rotation.set(0.4, -0.3, 0.5);
            whale.add(finR);

            // Dorsal fin
            const dorsalShape = new THREE.Shape();
            dorsalShape.moveTo(0, 0);
            dorsalShape.bezierCurveTo(0.5, 1.2, 1.5, 1.5, 2, 0.8);
            dorsalShape.bezierCurveTo(1.5, 0.2, 0.5, 0, 0, 0);
            const dorsalGeom = new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.08, bevelEnabled: false });
            const dorsal = new THREE.Mesh(dorsalGeom, skin);
            dorsal.position.set(-1.5, 1.0, -0.04);
            dorsal.rotation.set(0, 0, 0.1);
            whale.add(dorsal);

            // Tubercles (bumps on head — humpback characteristic)
            for (let i = 0; i < 8; i++) {
                const tbGeom = new THREE.SphereGeometry(THREE.MathUtils.randFloat(0.07, 0.14), 8, 6);
                const tb = new THREE.Mesh(tbGeom, skin);
                tb.position.set(
                    THREE.MathUtils.randFloat(3.5, 5.2),
                    THREE.MathUtils.randFloat(0.3, 0.7),
                    THREE.MathUtils.randFloatSpread(0.8),
                );
                whale.add(tb);
            }

            // Eye
            const eyeGeom = new THREE.SphereGeometry(0.1, 12, 8);
            const eyeMat = new THREE.MeshPhongMaterial({ color: 0x0a0a0a, shininess: 100, specular: 0x444444 });
            const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
            eyeL.position.set(3.8, 0.35, 1.1);
            whale.add(eyeL);
            const eyeR = eyeL.clone();
            eyeR.position.z = -1.1;
            whale.add(eyeR);

            return whale;
        }

        const whale = buildWhale();
        whale.position.set(8, -1, -5);
        whale.rotation.y = -0.3;
        whale.scale.setScalar(1.2);
        scene.add(whale);

        // ── Second distant whale ─────────────────────────────────────────────
        const whale2 = buildWhale();
        whale2.position.set(-30, 5, -25);
        whale2.rotation.y = Math.PI + 0.4;
        whale2.scale.setScalar(0.55);
        scene.add(whale2);

        // ── Lighting ─────────────────────────────────────────────────────────
        scene.add(new THREE.AmbientLight(0x003366, 1.2));

        const sunLight = new THREE.DirectionalLight(0x88ccff, 1.8);
        sunLight.position.set(10, 30, 5);
        scene.add(sunLight);

        const fillLight = new THREE.PointLight(0x0044aa, 1.0, 60);
        fillLight.position.set(-10, 5, 10);
        scene.add(fillLight);

        const rimLight = new THREE.PointLight(0x00aadd, 0.6, 40);
        rimLight.position.set(0, -8, 15);
        scene.add(rimLight);

        // ── Resize ───────────────────────────────────────────────────────────
        const onResize = () => {
            if (!mount) return;
            camera.aspect = mount.clientWidth / mount.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", onResize);

        // ── Animation Loop ────────────────────────────────────────────────────
        let frame = 0;
        const clock = new THREE.Clock();
        const bPosArr = bubbleGeom.attributes.position.array as Float32Array;

        const animate = () => {
            frame = requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            bgMat.uniforms.uTime.value = t;

            // Whale swimming
            whale.position.x = 8 - t * 0.35;
            if (whale.position.x < -50) whale.position.x = 55;
            whale.position.y = -1 + Math.sin(t * 0.4) * 1.2;
            whale.rotation.z = Math.sin(t * 0.4) * 0.06;
            whale.rotation.y = -0.3 + Math.sin(t * 0.15) * 0.08;

            // Tail undulation
            const tailStock = whale.children[3] as THREE.Mesh;
            if (tailStock) tailStock.rotation.y = Math.sin(t * 1.8) * 0.35;
            const flukeTop = whale.children[4] as THREE.Mesh;
            if (flukeTop) flukeTop.rotation.z = Math.sin(t * 1.8) * 0.25 - 0.2;
            const flukeBot = whale.children[5] as THREE.Mesh;
            if (flukeBot) flukeBot.rotation.z = Math.sin(t * 1.8) * 0.25 + 0.2;

            // Fin gentle wave
            const finL = whale.children[6] as THREE.Mesh;
            if (finL) finL.rotation.z = 0.5 + Math.sin(t * 0.9) * 0.1;
            const finR = whale.children[7] as THREE.Mesh;
            if (finR) finR.rotation.z = 0.5 + Math.sin(t * 0.9 + 0.5) * 0.1;

            // Distant whale
            whale2.position.x = -30 + t * 0.18;
            if (whale2.position.x > 50) whale2.position.x = -55;
            whale2.position.y = 5 + Math.sin(t * 0.35 + 1) * 0.8;

            // God rays pulse
            rays.forEach(ray => {
                const { speed, phase, baseOpacity } = ray.userData;
                (ray.material as THREE.MeshBasicMaterial).opacity =
                    baseOpacity * (0.7 + 0.3 * Math.sin(t * speed + phase));
                ray.rotation.z = Math.sin(t * speed * 0.5 + phase) * 0.04;
            });

            // Bubbles rise
            for (let i = 0; i < BUBBLE_COUNT; i++) {
                bPosArr[i * 3 + 1] += bSpeeds[i] * 0.015;
                bPosArr[i * 3]     += Math.sin(t * 0.5 + i) * 0.003;
                if (bPosArr[i * 3 + 1] > 30) {
                    bPosArr[i * 3 + 1] = -20;
                    bPosArr[i * 3]     = THREE.MathUtils.randFloatSpread(80);
                }
            }
            bubbleGeom.attributes.position.needsUpdate = true;

            // Camera gentle drift
            camera.position.x = Math.sin(t * 0.07) * 1.5;
            camera.position.y = Math.cos(t * 0.05) * 0.8;
            camera.lookAt(0, 0, 0);

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
