# 게임으로 보낼 묶음: JSON(목록) + BIN(배열). 배열은 4바이트 정렬.
import json, numpy as np

TYPES = {'f32': np.float32, 'u8': np.uint8, 'u8n': np.uint8, 'u16': np.uint16, 'u32': np.uint32,
         'i16n': np.int16, 'u16n': np.uint16, 'i8n': np.int8}

class Packer:
    def __init__(self):
        self.chunks = []
        self.size = 0
        self.meta = {'version': 1, 'meshes': [], 'bones': [], 'textures': {}, 'extra': {}}

    def add(self, arr, kind):
        a = np.asarray(arr)
        if kind == 'i16n':
            a = np.clip(np.round(a * 32767), -32767, 32767)
        elif kind == 'u16n':
            a = np.clip(np.round(a * 65535), 0, 65535)
        elif kind == 'u8n':
            a = np.clip(np.round(a * 255), 0, 255)
        elif kind == 'i8n':
            a = np.clip(np.round(a * 127), -127, 127)
        a = np.ascontiguousarray(a.astype(TYPES[kind]))
        b = a.tobytes()
        off = self.size
        self.chunks.append(b)
        self.size += len(b)
        pad = (-self.size) % 4
        if pad:
            self.chunks.append(b'\0' * pad)
            self.size += pad
        size = a.shape[1] if a.ndim > 1 else 1
        return {'offset': off, 'type': kind, 'size': size, 'count': int(a.shape[0])}

    def mesh(self, name, material, attrs, index, morphs=None, bone=None, extra=None):
        m = {'name': name, 'material': material, 'bone': bone, 'attributes': {}, 'morphs': {}}
        for k, (arr, kind) in attrs.items():
            m['attributes'][k] = self.add(arr, kind)
        idx = np.asarray(index).ravel()
        m['index'] = self.add(idx, 'u16' if idx.max() < 65535 else 'u32')
        for k, arr in (morphs or {}).items():
            m['morphs'][k] = self.add(arr, 'f32')
        if extra:
            m.update(extra)
        self.meta['meshes'].append(m)

    def write(self, path_base):
        with open(path_base + '.bin', 'wb') as f:
            for c in self.chunks:
                f.write(c)
        self.meta['bytes'] = self.size
        with open(path_base + '.json', 'w') as f:
            json.dump(self.meta, f, ensure_ascii=False, separators=(',', ':'))
