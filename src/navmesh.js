/** @namespace Gamespace */
import * as THREE from "three";
import {
  clamp,
  project_on_plane,
  triangle_normal,
  get_barycentric_coordinates,
  barycentric_to_cartesian,
  project_line_on_line,
	project_on_line,
} from "./math.js";

class Vertex {
  constructor(x, y, z) {
    this.pos = new THREE.Vector3(x, y, z);
  }
}

class Edge {
  /**
	 * @param {string} id .
   * @param {Vertex} a .
   * @param {Vertex} b .
   */
  constructor(id, a, b) {
		this.id = id
    this.a = a;
    this.b = b;
    /** @type {Face} */
    this.left = null;
    /** @type {Face} */
    this.right = null;

    this.length = a.pos.distanceTo(b.pos);
  }

  /**
   * @param {Vertex} v .
   */
  has(v) {
    return this.a == v || this.b == v;
  }

  /**
   * @param {Face} face .
   */
  add(face) {
    if (!this.left) {
      this.left = face;
    } else if (!this.right) {
      this.right = face;
    } else {
      throw new Error("Edge::add error. Edge already has two faces");
    }
  }

  /**
   * @param {Face} face .
   */
  other(face) {
    if (this.left == face) {
      return this.right;
    }
    if (this.right == face) {
      return this.left;
    }
  }

  dispose() {
    this.left = null;
    this.right = null;
    this.a = null;
    this.b = null;
  }
}

class Face {
  /**
   * @param {string} id .
   * @param {Vertex} pa .
   * @param {Vertex} pb .
   * @param {Vertex} pc .
   * @param {Edge} ea .
   * @param {Edge} eb .
   * @param {Edge} ec .
   */
  constructor(id, pa, pb, pc, ea, eb, ec) {
    this.id = id;
    this.pa = pa;
    this.pb = pb;
    this.pc = pc;
    this.ea = ea;
    this.eb = eb;
    this.ec = ec;

    this.ea.add(this);
    this.eb.add(this);
    this.ec.add(this);

    this.normal = new THREE.Vector3().copy(
      triangle_normal(pa.pos, pb.pos, pc.pos),
    );
  }

  /**
   * @param {Vertex} v .
   */
  find_opposide_edge(v) {
    if (!this.ea.has(v)) {
      return this.ea;
    }
    if (!this.eb.has(v)) {
      return this.eb;
    }
    if (!this.ec.has(v)) {
      return this.ec;
    }
  }

  dispose() {
    this.ea.dispose();
    this.eb.dispose();
    this.eb.dispose();
    this.ea = null;
    this.eb = null;
    this.ec = null;
    this.pa = null;
    this.pb = null;
    this.pc = null;
  }
}

class NavmeshPoint {
  /**
   * @param {string} id .
   * @param {THREE.Vector3} worldpos .
   * @param {THREE.Vector3} bcpos .
   * @param {Face} face .
   */
  constructor(id, worldpos, bcpos, face) {
    this.worldpos = new THREE.Vector3().copy(worldpos);
    this.bcpos = new THREE.Vector3().copy(bcpos);
    this.id = id;
    this.face = face;
  }
}

class Navmesh {
  constructor() {
    /** @type {Object<number, Vertex>} */
    this.verticies = {};
    /** @type {Object<string, Edge>} */
    this.edges = {};
    /** @type {Object<string, Face>} */
    this.faces = {};

    /**
     * Registered navigation points
     *
     * @type {Object<string, NavmeshPoint>}
     */
    this.points = {};

    this.guids = 0;

    this.cache = {
      v3: new THREE.Vector3(),
      v3_0: new THREE.Vector3(),
      vecnames_to_facenames: {
        x: "pa",
        y: "pb",
        z: "pc",
      },
    };
  }

  /**
   * @param {number} a
   * @param {number} b
   * @param {number} [c]
   * @returns {string} .
   */
  _hash(a, b, c = 1.1) {
    const hash = a + b + c + Math.log(a * b * c + 1);
    return "h" + Math.round(hash * 1e8);
  }

  /**
   * Creates new point on navmesh
   *
   * @param {THREE.Vector3} pos .
   * @returns {string} point id
   */
  register(pos) {
    for (const k in this.faces) {
      const face = this.faces[k];
      const normal = face.normal;
      const projected_pos = this.cache.v3.copy(
        project_on_plane(pos, face.pa.pos, normal),
      );
      const bcpos = get_barycentric_coordinates(
        face.pa.pos,
        face.pb.pos,
        face.pc.pos,
        projected_pos,
      );
      if (bcpos.x >= 0 && bcpos.y >= 0 && bcpos.z >= 0) {
        const id = "p" + this.guids++;
        const point = new NavmeshPoint(id, projected_pos, bcpos, face);
        this.points[id] = point;
        console.log(point);

        return id;
      }
    }

    return null;
  }

  /**
   * @param {string} id id of registered point
   * @param {THREE.Vector3} newpos pos that has to be applied
   */
  move(id, newpos) {
		const np = this.cache.v3.copy(newpos);
    const p = this.points[id];

    let changed = true;
    let deadlock = 0;
		let tested_edges = {};

    while (changed) {
      const face = p.face;
      const normal = face.normal;

      const projected_pos = this.cache.v3_0.copy(
        project_on_plane(np, face.pa.pos, normal),
      );
      const bcpos = get_barycentric_coordinates(
        face.pa.pos,
        face.pb.pos,
        face.pc.pos,
        projected_pos,
      );

      changed = false;
      let noface = false;
      let edge = null;

      // finds out if point outside current triangle.
      // rolls again if it is
      for (const k in this.cache.vecnames_to_facenames) {
        const kn = this.cache.vecnames_to_facenames[k];

        if (bcpos[k] < 0) {
          const e = face.find_opposide_edge(face[kn]);
					if (tested_edges[e.id]) {
						continue;
					}

					tested_edges[e.id] = e;

          const f = e.other(face);
          if (f) {
            p.face = f;
            changed = true;
            noface = false;
          } else  {
            noface = true;
            edge = e;
          }
					break;
        }
      }

			// correction step - clamp into noface triangle
			if (noface) {
				const linepos = project_on_line(
					edge.a.pos,
					edge.b.pos,
					projected_pos);
				np.copy(linepos);
				changed = true;
			}

      // final step - point inside triangle
      // apply
      if (!changed) {
				p.bcpos.copy(bcpos);
				p.worldpos.copy(
					barycentric_to_cartesian(
						p.face.pa.pos,
						p.face.pb.pos,
						p.face.pc.pos,
						bcpos,
					),
				);
      }

      if (deadlock > 10) {
        throw new Error("Navmesh::move. Deadlock");
      }
    }

    return p.worldpos;
  }

  /**
   * @param {THREE.Mesh} mesh
   */
  build(mesh) {
    const indices = mesh.geometry.getIndex();
    const positions = mesh.geometry.getAttribute("position");
    const p = positions.array;
    console.log(indices, positions);
    for (let i = 0; i < indices.count; i += 3) {
      const pid1 = indices.array[i];
      const pid2 = indices.array[i + 1];
      const pid3 = indices.array[i + 2];
      const id1 = pid1 * 3;
      const id2 = pid2 * 3;
      const id3 = pid3 * 3;
      const v1 =
        this.verticies[pid1] ??
        (this.verticies[pid1] = new Vertex(p[id1], p[id1 + 1], p[id1 + 2]));
      const v2 =
        this.verticies[pid2] ??
        (this.verticies[pid2] = new Vertex(p[id2], p[id2 + 1], p[id2 + 2]));
      const v3 =
        this.verticies[pid3] ??
        (this.verticies[pid3] = new Vertex(p[id3], p[id3 + 1], p[id3 + 2]));
      const hash1 = this._hash(id1, id2);
      const hash2 = this._hash(id2, id3);
      const hash3 = this._hash(id3, id1);
      const e1 = this.edges[hash1] ?? (this.edges[hash1] = new Edge(hash1, v1, v2));
      const e2 = this.edges[hash2] ?? (this.edges[hash2] = new Edge(hash2, v2, v3));
      const e3 = this.edges[hash3] ?? (this.edges[hash3] = new Edge(hash3, v3, v1));
      const hashf = this._hash(id1, id2, id3);
      const face = new Face(hashf, v1, v2, v3, e1, e2, e3);
      this.faces[hashf] = face;
    }
  }

  dispose() {
    for (const k in this.faces) {
      this.faces[k].dispose();
    }

    this.verticies = {};
    this.edges = {};
    this.faces = {};
  }
}

export default Navmesh;