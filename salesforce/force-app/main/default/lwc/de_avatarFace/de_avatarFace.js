import { LightningElement, api } from "lwc";
import { loadScript } from "lightning/platformResourceLoader";
import DE_THREE_BUNDLE from "@salesforce/resourceUrl/de_threeBundle";
import DE_AVATAR_GLB from "@salesforce/resourceUrl/de_avatarGlb";

/**
 * de_avatarFace — a lip-synced 3D avatar bust ported from the standalone
 * realtime-avatar demo. Renders a GLB with viseme morph targets via Three.js
 * (loaded as a bundled IIFE static resource, since platformResourceLoader can't
 * load ES modules) and drives the mouth from SpeechSynthesis timers.
 *
 * It is a dumb renderer: Agentforce is the brain. The host (de_custom_chat_header)
 * calls speak(text) for each agent reply.
 *
 * Public API: speak(text), mute(bool), prime(), @api language, @api big.
 */

// Viseme groups cycled while speaking (same set the demo used).
const VISEME_SETS = [
    ["viseme_aa", "jawOpen"],
    ["viseme_E"],
    ["viseme_I"],
    ["viseme_O", "jawOpen"],
    ["viseme_U"],
    ["viseme_PP"],
    ["viseme_SS"],
    ["viseme_nn"],
    ["viseme_RR"],
    ["viseme_DD"]
];
const MOUTH_SHAPES = [
    "viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_PP",
    "viseme_SS", "viseme_nn", "viseme_RR", "viseme_DD", "viseme_CH", "viseme_FF",
    "viseme_TH", "viseme_kk", "jawOpen", "mouthOpen"
];

export default class DeAvatarFace extends LightningElement {
    @api language = "en-US";

    // --- public reactive props -------------------------------------------
    _big = false;
    @api
    get big() {
        return this._big;
    }
    set big(value) {
        this._big = Boolean(value);
        this.applyBig();
    }

    // --- Three.js handles -------------------------------------------------
    _loaded = false;
    _canvas;
    renderer;
    scene;
    camera;
    clock;
    model;
    rafId = null;
    frame = null;
    headHeights = 1.9; // tighter than the demo's 3.0 for a head-only bust

    morphIndex = {};
    current = {};
    target = {};

    // --- speech state -----------------------------------------------------
    _queue = [];
    _muted = true; // muted until the user unlocks audio (prime())
    _primed = false;
    _speaking = false;
    mouthTimer = null;
    nextBlink = 2 + Math.random() * 3;

    // ---------------------------------------------------------------------
    renderedCallback() {
        if (this._loaded) {
            return;
        }
        this._loaded = true;
        this._canvas = this.template.querySelector("canvas");
        loadScript(this, DE_THREE_BUNDLE)
            .then(() => this.boot())
            .catch((e) => {
                // eslint-disable-next-line no-console
                console.error("[de_avatarFace] failed to load Three.js bundle", e);
            });

        if ("speechSynthesis" in window) {
            // Warm the voice list (loads async in most browsers).
            speechSynthesis.onvoiceschanged = () => {};
            speechSynthesis.getVoices();
        }
    }

    disconnectedCallback() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        try {
            speechSynthesis.cancel();
        } catch (e) {
            /* no-op */
        }
        this.stopMouth();
        this.clearModel();
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer = null;
        }
    }

    // --- boot / three setup ----------------------------------------------
    boot() {
        const bundle = window.DE_THREE;
        if (!bundle || !this._canvas) {
            return;
        }
        this.THREE = bundle.THREE;
        this.GLTFLoader = bundle.GLTFLoader;
        this.RoomEnvironment = bundle.RoomEnvironment;

        const THREE = this.THREE;
        this.renderer = new THREE.WebGLRenderer({
            canvas: this._canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
        this.clock = new THREE.Clock();

        // soft image-based studio lighting → realistic skin/shading
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.scene.environment = pmrem.fromScene(new this.RoomEnvironment(), 0.04).texture;

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9cdee, 0.45));
        const key = new THREE.DirectionalLight(0xfff2e2, 2.2);
        key.position.set(1.2, 2.2, 2.4);
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0xdbe8ff, 0.9);
        fill.position.set(-2, 1.2, 1.6);
        this.scene.add(fill);
        const rim = new THREE.DirectionalLight(0xffffff, 1.4);
        rim.position.set(-0.6, 2.4, -2.2);
        this.scene.add(rim);

        this.resize();
        this.loadAvatar(DE_AVATAR_GLB);
        this.animate();
    }

    resize() {
        const canvas = this._canvas;
        if (!canvas || !this.renderer || !this.camera) {
            return;
        }
        const w = canvas.clientWidth || 56;
        const h = canvas.clientHeight || 56;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    reframe() {
        if (!this.frame || !this.camera) {
            return;
        }
        const f = this.frame;
        this.camera.position.set(f.x, f.y, f.z + f.dist);
        this.camera.lookAt(f.x, f.y, f.z);
    }

    // --- morph helpers ----------------------------------------------------
    setMorphTarget(n, v) {
        this.target[n] = v;
    }
    has(n) {
        return !!this.morphIndex[n];
    }
    getMorphNames(a) {
        return a.filter((n) => this.has(n));
    }

    clearModel() {
        if (this.model && this.scene) {
            this.scene.remove(this.model);
            this.model.traverse((o) => {
                if (o.geometry) {
                    o.geometry.dispose();
                }
            });
        }
        this.model = null;
        this.morphIndex = {};
        this.current = {};
        this.target = {};
    }

    loadAvatar(url) {
        const THREE = this.THREE;
        const loader = new this.GLTFLoader();
        loader.load(
            url,
            (gltf) => {
                this.clearModel();
                this.model = gltf.scene;
                this.scene.add(this.model);

                let headBone = null;
                this.model.traverse((o) => {
                    if (o.isBone && /head/i.test(o.name) && !/top/i.test(o.name)) {
                        headBone = headBone || o;
                    }
                    if (o.isMesh) {
                        o.frustumCulled = false;
                        if (o.material) {
                            o.material.envMapIntensity = 1.0;
                        }
                        if (o.morphTargetDictionary) {
                            for (const [n, idx] of Object.entries(o.morphTargetDictionary)) {
                                (this.morphIndex[n] = this.morphIndex[n] || []).push({ mesh: o, idx });
                                this.current[n] = 0;
                                this.target[n] = 0;
                            }
                        }
                    }
                });

                // Head-bone-anchored framing (scale-independent) → head + a sliver of shoulders.
                this.model.updateWorldMatrix(true, true);
                const box = new THREE.Box3().setFromObject(this.model);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const fov = (this.camera.fov * Math.PI) / 180;
                if (headBone) {
                    const hp = new THREE.Vector3();
                    headBone.getWorldPosition(hp);
                    const u = Math.max(1e-4, box.max.y - hp.y); // ≈ head height
                    const lookY = hp.y + u * 0.35;
                    const visibleH = u * this.headHeights;
                    this.frame = { x: hp.x, y: lookY, z: hp.z, dist: visibleH / 2 / Math.tan(fov / 2) };
                } else {
                    const lookY = box.max.y - size.y * 0.1;
                    const visibleH = Math.max(size.y * 0.4, 1e-3);
                    this.frame = { x: center.x, y: lookY, z: box.max.z, dist: visibleH / 2 / Math.tan(fov / 2) };
                }
                this.reframe();
                this.restingFace();
            },
            undefined,
            (e) => {
                // eslint-disable-next-line no-console
                console.error("[de_avatarFace] GLB load error", e);
            }
        );
    }

    restingFace() {
        ["mouthSmileLeft", "mouthSmileRight", "mouthSmile"].forEach((n) => {
            if (this.has(n)) {
                this.setMorphTarget(n, 0.2);
            }
        });
        if (this.has("browInnerUp")) {
            this.setMorphTarget("browInnerUp", 0.06);
        }
    }

    // --- lip-sync ---------------------------------------------------------
    clearMouth() {
        MOUTH_SHAPES.forEach((n) => {
            if (this.has(n)) {
                this.setMorphTarget(n, 0);
            }
        });
    }
    randomViseme(strength = 1) {
        this.clearMouth();
        const set = VISEME_SETS[Math.floor(Math.random() * VISEME_SETS.length)];
        set.forEach((n) => {
            if (this.has(n)) {
                this.setMorphTarget(n, (n === "jawOpen" ? 0.35 : 0.7) * strength);
            }
        });
        if (this.has("jawOpen") && !set.includes("jawOpen")) {
            this.setMorphTarget("jawOpen", 0.12 * strength + Math.random() * 0.15);
        }
    }
    startMouth() {
        this.clearInterval();
        this.mouthTimer = setInterval(() => this.randomViseme(0.9 + Math.random() * 0.3), 95);
    }
    stopMouth() {
        this.clearInterval();
        this.clearMouth();
    }
    clearInterval() {
        if (this.mouthTimer) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            window.clearInterval(this.mouthTimer);
            this.mouthTimer = null;
        }
    }
    emphasize() {
        if (this._speaking && this.has("jawOpen")) {
            this.setMorphTarget("jawOpen", 0.5);
        }
    }

    doBlink() {
        const n = this.getMorphNames(["eyeBlinkLeft", "eyeBlinkRight"]);
        if (!n.length) {
            return;
        }
        n.forEach((x) => this.setMorphTarget(x, 1));
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => n.forEach((x) => this.setMorphTarget(x, 0)), 110);
    }

    animate() {
        this.rafId = requestAnimationFrame(() => this.animate());
        if (!this.renderer) {
            return;
        }
        const dt = this.clock.getDelta();
        const t = this.clock.elapsedTime;
        for (const name in this.current) {
            if (!Object.prototype.hasOwnProperty.call(this.current, name)) {
                continue;
            }
            const sp = name.startsWith("eyeBlink") ? 0.6 : 0.35;
            this.current[name] += ((this.target[name] || 0) - this.current[name]) * Math.min(1, sp);
            const list = this.morphIndex[name];
            if (list) {
                for (const { mesh, idx } of list) {
                    mesh.morphTargetInfluences[idx] = this.current[name];
                }
            }
        }
        if (this.model) {
            this.model.position.y = Math.sin(t * 1.2) * 0.004;
            this.model.rotation.y = Math.sin(t * 0.4) * 0.035;
            this.model.rotation.z = Math.sin(t * 0.9) * 0.005;
        }
        this.nextBlink -= dt;
        if (this.nextBlink <= 0) {
            this.doBlink();
            this.nextBlink = 2.5 + Math.random() * 3.5;
        }
        this.renderer.render(this.scene, this.camera);
    }

    // --- speech -----------------------------------------------------------
    pickVoice(l) {
        const v = speechSynthesis.getVoices();
        return (
            v.find((x) => x.lang === l) ||
            v.find((x) => x.lang && x.lang.startsWith(l.split("-")[0])) ||
            null
        );
    }

    /**
     * Public: speak one agent reply (sequential; honors mute/prime).
     * Dropped while muted — this is what keeps the avatar from reciting chat
     * history on reload (the transcript re-renders while muted) and from
     * replaying a stale greeting the moment the user enables voice.
     */
    @api
    speak(text) {
        if (!text || this._muted || !this._primed) {
            return;
        }
        this._queue.push(String(text));
        this.pump();
    }

    /** Public: mute/unmute. Muting cancels any in-flight speech. */
    @api
    mute(flag) {
        this._muted = Boolean(flag);
        if (this._muted) {
            try {
                speechSynthesis.cancel();
            } catch (e) {
                /* no-op */
            }
            this.stopMouth();
            this.restingFace();
            this._speaking = false;
        } else {
            this.pump();
        }
    }

    /**
     * Public: unlock browser audio. MUST be called from within a user-gesture
     * handler (e.g. the header's speaker toggle click).
     */
    @api
    prime() {
        if (this._primed) {
            return;
        }
        this._primed = true;
        try {
            speechSynthesis.resume();
            const u = new SpeechSynthesisUtterance(" ");
            u.volume = 0;
            speechSynthesis.speak(u);
        } catch (e) {
            /* no-op */
        }
        this.pump();
    }

    pump() {
        if (this._muted || !this._primed || this._speaking) {
            return;
        }
        if (!("speechSynthesis" in window)) {
            this._queue = [];
            return;
        }
        const text = this._queue.shift();
        if (text === undefined) {
            return;
        }
        this.speakNow(text);
    }

    speakNow(text) {
        this._speaking = true;
        try {
            speechSynthesis.cancel();
        } catch (e) {
            /* no-op */
        }
        const u = new SpeechSynthesisUtterance(text);
        u.lang = this.language;
        const v = this.pickVoice(this.language);
        if (v) {
            u.voice = v;
        }
        u.rate = 1.0;
        u.pitch = 1.1;
        u.onstart = () => this.startMouth();
        u.onboundary = () => this.emphasize();
        const done = () => {
            this.stopMouth();
            this.restingFace();
            this._speaking = false;
            this.pump();
        };
        u.onend = done;
        u.onerror = done;
        speechSynthesis.speak(u);
    }

    // --- presentation -----------------------------------------------------
    applyBig() {
        if (this._big) {
            this.classList.add("is-big");
        } else {
            this.classList.remove("is-big");
        }
        // Resize after the CSS size change lands.
        requestAnimationFrame(() => this.resize());
    }
}
