# -*- coding: utf-8 -*-
"""Read and rewrite the vertex positions of a .glb, with no third-party deps.

A .glb is a 12-byte header followed by chunks: a JSON chunk describing the
glTF, then a binary chunk holding the actual buffers. Nothing here needs a
mesh library - the positions are a flat float32 array at a known offset, and
the skin weights say which bone owns each vertex. numpy does the rest.

Used by art/fix_kaelen_hips.py. Kept separate because reading a model and
changing one is worth having apart: the read side is run on its own whenever a
report is about geometry rather than code, and it must not be able to write.
"""
import json
import struct

import numpy as np

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

# glTF componentType -> numpy dtype
COMPONENT = {
    5120: np.int8, 5121: np.uint8, 5122: np.int16,
    5123: np.uint16, 5125: np.uint32, 5126: np.float32,
}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


class Glb(object):
    def __init__(self, path):
        with open(path, 'rb') as fh:
            data = fh.read()
        magic, version, total = struct.unpack_from('<III', data, 0)
        if magic != GLB_MAGIC:
            raise ValueError('not a glb: magic %x' % magic)
        self.version = version
        self.json = None
        self.bin = None
        off = 12
        while off < total:
            clen, ctype = struct.unpack_from('<II', data, off)
            body = data[off + 8:off + 8 + clen]
            if ctype == JSON_CHUNK:
                self.json = json.loads(body.decode('utf-8'))
            elif ctype == BIN_CHUNK:
                self.bin = bytearray(body)
            off += 8 + clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
        if self.json is None or self.bin is None:
            raise ValueError('glb missing a JSON or BIN chunk')

    # -- reading -----------------------------------------------------------
    def accessor(self, index):
        """An accessor as an (count, ncomp) numpy array. Interleaved views are
        handled: byteStride is honoured rather than assumed to be tight."""
        acc = self.json['accessors'][index]
        n = acc['count']
        ncomp = NCOMP[acc['type']]
        dt = COMPONENT[acc['componentType']]
        bv = self.json['bufferViews'][acc['bufferView']]
        base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = bv.get('byteStride')
        itemsize = np.dtype(dt).itemsize
        if not stride or stride == ncomp * itemsize:
            raw = np.frombuffer(bytes(self.bin[base:base + n * ncomp * itemsize]), dtype=dt)
            return raw.reshape(n, ncomp).copy()
        out = np.empty((n, ncomp), dtype=dt)
        for i in range(n):
            o = base + i * stride
            out[i] = np.frombuffer(bytes(self.bin[o:o + ncomp * itemsize]), dtype=dt)
        return out

    def accessor_offset(self, index):
        """Where an accessor's data starts in the BIN chunk, and its stride -
        what write_positions needs to put values back."""
        acc = self.json['accessors'][index]
        bv = self.json['bufferViews'][acc['bufferView']]
        base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        ncomp = NCOMP[acc['type']]
        itemsize = np.dtype(COMPONENT[acc['componentType']]).itemsize
        return base, bv.get('byteStride') or ncomp * itemsize

    def skinned_primitive(self):
        """The first primitive that has skin weights, with its mesh name."""
        for mi, mesh in enumerate(self.json['meshes']):
            for prim in mesh['primitives']:
                if 'JOINTS_0' in prim.get('attributes', {}):
                    return mesh.get('name', 'mesh%d' % mi), prim
        raise ValueError('no skinned primitive')

    def joint_names(self):
        """Joint index (as used by JOINTS_0) -> node name."""
        skin = self.json['skins'][0]
        nodes = self.json['nodes']
        return [nodes[j].get('name', 'joint%d' % j) for j in skin['joints']]

    def dominant_joint(self, prim):
        """For each vertex, the joint index holding the most weight."""
        j = self.accessor(prim['attributes']['JOINTS_0']).astype(np.int32)
        w = self.accessor(prim['attributes']['WEIGHTS_0']).astype(np.float64)
        if w.dtype != np.float64:
            w = w.astype(np.float64)
        pick = np.argmax(w, axis=1)
        return j[np.arange(len(j)), pick], w[np.arange(len(w)), pick]

    # -- writing -----------------------------------------------------------
    def write_vec3(self, prim, attr, data):
        """Put a float32 VEC3 attribute back. POSITION also gets its min/max
        refreshed, because a stale bounding box makes a viewer cull the mesh
        at the wrong moment - and three.js reads it for frustum culling."""
        idx = prim['attributes'][attr]
        acc = self.json['accessors'][idx]
        if acc['componentType'] != 5126 or acc['type'] != 'VEC3':
            raise ValueError('%s is not float32 VEC3' % attr)
        base, stride = self.accessor_offset(idx)
        data = np.ascontiguousarray(data.astype(np.float32))
        if stride == 12:
            self.bin[base:base + data.nbytes] = data.tobytes()
        else:
            for i in range(len(data)):
                o = base + i * stride
                self.bin[o:o + 12] = data[i].tobytes()
        if attr == 'POSITION':
            acc['min'] = [float(v) for v in data.min(axis=0)]
            acc['max'] = [float(v) for v in data.max(axis=0)]

    def write_positions(self, prim, pos):
        self.write_vec3(prim, 'POSITION', pos)

    def recompute_normals(self, prim, pos):
        """Area-weighted vertex normals from the triangles.

        Moving vertices without this leaves the old normals behind, and the
        shading - not the silhouette - is what sells a shape on a metallic
        character: the lighting would still describe the bulge that is no
        longer there."""
        idx = self.accessor(prim['indices']).reshape(-1).astype(np.int64)
        tri = idx.reshape(-1, 3)
        a, b, c = pos[tri[:, 0]], pos[tri[:, 1]], pos[tri[:, 2]]
        # Un-normalised cross product: its length is twice the triangle's
        # area, so accumulating it area-weights each face's contribution.
        fn = np.cross(b - a, c - a)
        nrm = np.zeros_like(pos)
        for k in range(3):
            np.add.at(nrm, tri[:, k], fn)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        ln[ln == 0] = 1.0
        return nrm / ln

    def save(self, path):
        raw = json.dumps(self.json, separators=(',', ':')).encode('utf-8')
        raw += b' ' * ((4 - len(raw) % 4) % 4)
        binc = bytes(self.bin)
        binc += b'\x00' * ((4 - len(binc) % 4) % 4)
        total = 12 + 8 + len(raw) + 8 + len(binc)
        with open(path, 'wb') as fh:
            fh.write(struct.pack('<III', GLB_MAGIC, 2, total))
            fh.write(struct.pack('<II', len(raw), JSON_CHUNK))
            fh.write(raw)
            fh.write(struct.pack('<II', len(binc), BIN_CHUNK))
            fh.write(binc)
        return total
