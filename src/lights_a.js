import * as THREE from "three";
import Render from "./render.js";
import { CSM } from "three/addons/csm/CSM.js";
import { RenderConfig } from "./config.js";
import logger from "./logger.js";
import Loader from "./loader.js";

class LightsA {
  constructor() {
    /** @type {CSM} */
    this.csm = null;
    this.lights = {
      /** @type {THREE.DirectionalLight} */
      directional: null,
      /** @type {THREE.AmbientLight} */
      ambient: null,
      /** @type {THREE.HemisphereLight} */
      hemisphere: null,
    };
  }

  /**
   * @param {Render} render .
   */
  run(render) {
    const scene = render.scene;
    const ambient = new THREE.AmbientLight(0xffffff, 1);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 50, 100);
    scene.add(directional);
    const hemisphere = new THREE.HemisphereLight(0xffffbb, 0xffffbb, 1);
    scene.add(hemisphere);

    this.lights.directional = directional;
    this.lights.ambient = ambient;
    this.lights.hemisphere = hemisphere;

    if (RenderConfig.instance.shadows) {
      if (RenderConfig.instance.cascaded_shadow_maps) {
        this._run_csm(render.camera, scene);
      } else {
        directional.castShadow = true;
        directional.shadow.mapSize.width = 256;
        directional.shadow.mapSize.height = 256;
        directional.shadow.camera.left = -32;
        directional.shadow.camera.bottom = -32;
        directional.shadow.camera.right = 32;
        directional.shadow.camera.top = 32;
        directional.shadow.camera.far = 10000;
      }
    }

    return this;
  }

  _run_csm(camera, scene) {
    const lightDirection = this.lights.directional.position
      .clone()
      .normalize()
      .negate();
    this.csm = new CSM({
      maxFar: 1000,
      cascades: 4,
      mode: "practical",
      parent: scene,
      shadowMapSize: 2048,
      lightDirection,
      camera,
    });
  }

  step(dt) {
    this.csm?.update();
  }

  stop() {
    for (const k in this.lights) {
      this.lights[k].removeFromParent();
      this.lights[k] = null;
    }

    this.csm?.dispose();
    this.csm = null;
  }

	/**
	 * @param {THREE.Object3D} scene
	 * @param {Object} conf
	 */
	static apply_shadowmaps(scene, conf) {
		for(const name in conf) {
			const prop = conf[name];
			let path = prop;
			let channel = 0;
			if (typeof prop == "object") {
				path = prop.path;
				channel = prop.channel;
			}
			const o =  scene.getObjectByName(name);
			if (!o) {
				logger.warn(`LightsA::apply_shadowmaps: no ${name} found in scene.`);
				continue;
			}

			/** @type {THREE.Mesh} */
			const m = /** @type {any} */ (o);
			if (!m.material) {
				logger.warn(`LightsA::apply_shadowmaps: object ${name} has no material.`);
				continue;
			}


			/** @type {THREE.MeshStandardMaterial} */
			const material = /** @type {any} */ (m.material);
			material.aoMap = Loader.instance.get_texture(path);
			material.aoMap.channel = channel;
			material.aoMap.flipY = false;
		}
	}
}

export default LightsA;