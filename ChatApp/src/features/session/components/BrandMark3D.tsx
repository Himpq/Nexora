import React, { useCallback, useEffect, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { Renderer } from "expo-three";
import * as THREE from "three";

import { colors, haptics } from "../../../design";

// --- Glyph geometry (a single, correct "N" silhouette) ----------------------
// Two stems + a diagonal slab, expressed as ONE closed outline so it extrudes
// into a single watertight solid (no coplanar overlaps → no z-fighting, and
// bevels stay clean). Coordinates are in ~unit space (≈1.2 tall).
const GW = 1.16; // glyph width
const GH = 1.28; // glyph height
const GS = 0.3; // stem thickness
const DEPTH = 0.44; // extrusion depth
// Where the diagonal's edges meet the stems' inner edges.
const YM = (GH * GS) / (GW - GS);

const N_OUTLINE: [number, number][] = [
  [0, 0],
  [0, GH],
  [GS, GH],
  [GW - GS, YM],
  [GW - GS, GH],
  [GW, GH],
  [GW, 0],
  [GW - GS, 0],
  [GS, GH - YM],
  [GS, 0],
];

// --- Interaction tuning -----------------------------------------------------
const DRAG_SENS = 0.011; // radians of rotation per px dragged
const MAX_PITCH = 1.25; // clamp X tilt (~70°) so it never flips disorientingly
const REST_PITCH = 0.13; // gentle resting tilt the pitch eases back to
const IDLE_SPIN = 0.0038; // slow idle yaw (radians/frame) — shows off the depth
const DECAY = 0.94; // flick-momentum decay per frame

const BG = parseInt(colors.background.slice(1), 16);

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * True-3D, freely rotatable "N" brand mark.
 *
 * A real extruded mesh rendered with three.js on an expo-gl surface, lit by a
 * key/fill/rim rig for genuine highlights and shading. Drag to spin it a full
 * 360° on its vertical axis; flick to send it spinning with momentum; left
 * alone it rotates slowly on its own. No fake "shadow disc" — the lighting does
 * the work.
 */
export function BrandMark3D() {
  const rot = useRef({ x: REST_PITCH, y: -0.6 });
  const vel = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);
  const raf = useRef<number | null>(null);
  const disposed = useRef(false);
  const cleanup = useRef<() => void>(() => {});

  useEffect(
    () => () => {
      disposed.current = true;
      if (raf.current != null) cancelAnimationFrame(raf.current);
      cleanup.current();
    },
    [],
  );

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        dragging.current = true;
        last.current = { x: 0, y: 0 };
        vel.current = { x: 0, y: 0 };
        haptics.impact("light");
      },
      onPanResponderMove: (_e, g) => {
        const dx = g.dx - last.current.x;
        const dy = g.dy - last.current.y;
        last.current = { x: g.dx, y: g.dy };
        rot.current.y += dx * DRAG_SENS;
        rot.current.x = clamp(
          rot.current.x + dy * DRAG_SENS,
          -MAX_PITCH,
          MAX_PITCH,
        );
        vel.current = { x: dy * DRAG_SENS, y: dx * DRAG_SENS };
      },
      onPanResponderRelease: () => {
        dragging.current = false;
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
      },
    }),
  ).current;

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;

    const renderer = new Renderer({ gl });
    renderer.setSize(width, height);
    renderer.setClearColor(BG, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 3.7);

    // Lighting rig: bright key from upper-left, cool fill, bright rim for edges.
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-4, 5, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaec4ff, 1.0);
    fill.position.set(5, -2, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(3, 4, -5);
    scene.add(rim);

    // Build the extruded "N" from its single outline.
    const shape = new THREE.Shape();
    shape.moveTo(N_OUTLINE[0][0], N_OUTLINE[0][1]);
    for (let i = 1; i < N_OUTLINE.length; i++) {
      shape.lineTo(N_OUTLINE[i][0], N_OUTLINE[i][1]);
    }
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.035,
      bevelSegments: 3,
      curveSegments: 4,
    });
    geometry.center();

    const material = new THREE.MeshStandardMaterial({
      color: 0x17171c,
      metalness: 0.3,
      roughness: 0.34,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    cleanup.current = () => {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };

    const animate = () => {
      if (disposed.current) return;
      raf.current = requestAnimationFrame(animate);

      const r = rot.current;
      const v = vel.current;
      if (!dragging.current) {
        r.y += v.y + IDLE_SPIN;
        r.x += v.x;
        v.y *= DECAY;
        v.x *= DECAY;
        r.x += (REST_PITCH - r.x) * 0.04; // ease pitch home
      }
      mesh.rotation.set(r.x, r.y, 0);

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    animate();
  }, []);

  return (
    <View style={styles.zone}>
      <View style={styles.glWrap} {...pan.panHandlers}>
        <GLView style={styles.gl} onContextCreate={onContextCreate} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    height: 244,
    alignItems: "center",
    justifyContent: "center",
  },
  glWrap: {
    width: 244,
    height: 244,
  },
  gl: {
    flex: 1,
  },
});
