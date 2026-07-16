import { useEffect, useRef } from 'react';

interface Props {
  level: number;
}

// Lifted from the original index.html canvas animation
export function BgCanvas({ level }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    frame: 0,
    level: -1,
    particles: [] as any[],
    pulseRings: [] as any[],
    bolts: [] as any[],
    matrixCols: [] as any[],
    timers: [] as any[],
    anims: [] as any[],
    rafId: 0,
    spawnFn: null as null | ((init?: boolean) => void),
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const s = stateRef.current;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function rnd(a: number, b: number) { return a + Math.random() * (b - a); }
    const W = () => canvas!.width;
    const H = () => canvas!.height;

    function spawn(init = false) {
      const p: any = { lv: s.level };
      switch (s.level) {
        case 0: Object.assign(p, { x: rnd(0,W()), y: init ? rnd(0,H()) : H()+80, r: rnd(50,150), vx: rnd(-0.25,0.25), vy: rnd(-0.15,-0.06), alpha: rnd(0.012,0.04), hue: rnd(185,215), ph: rnd(0,6.28) }); break;
        case 1: Object.assign(p, { x: rnd(0,W()), y: init ? rnd(0,H()) : H()+15, r: rnd(4,9), vy: rnd(-0.5,-0.2), alpha: rnd(0.04,0.1), ph: rnd(0,6.28), phv: rnd(0.012,0.025), life: 1 }); break;
        case 2: Object.assign(p, { x: rnd(0,W()), y: init ? rnd(0,H()) : H()+10, r: rnd(2,4.5), vx: rnd(-1.2,1.2), vy: rnd(-1.8,-0.6), alpha: rnd(0.35,0.75), rot: rnd(0,6.28), rotv: rnd(-0.08,0.08), life: 1 }); break;
        case 4: Object.assign(p, { x: rnd(W()*0.05, W()*0.95), y: init ? rnd(0,H()) : H()+8, r: rnd(1.5,4), vx: rnd(-2.5,2.5), vy: rnd(-7,-3), grav: rnd(0.05,0.1), alpha: rnd(0.6,1), hue: rnd(8,50), life: 1 }); break;
        case 6: { const a6 = rnd(0, Math.PI*2), s6 = 3+rnd(0,9); Object.assign(p, { x: rnd(0,W()), y: rnd(0,H()), r: 0.8+rnd(0,1.8), vx: Math.cos(a6)*s6, vy: Math.sin(a6)*s6, alpha: 0.6+rnd(0,0.4), life: 0.3+rnd(0,0.5) }); break; }
        case 7: Object.assign(p, { x: rnd(0,W()), y: rnd(0,H()), r: 2+rnd(0,5), vx: rnd(-7,7), vy: rnd(-7,7), alpha: 0.7+rnd(0,0.3), life: 1 }); break;
        case 8: Object.assign(p, { x: rnd(0,W()), y: init ? rnd(0,H()) : H()+10, r: rnd(4,10), vx: rnd(-5,5), vy: rnd(-12,-4), grav: 0.04, alpha: rnd(0.4,0.85), hue: rnd(0,45), life: 1 }); break;
        case 9: Object.assign(p, { x: rnd(0,W()), y: init ? rnd(0,H()) : H()+5, r: rnd(1,3), vx: rnd(-0.8,0.8), vy: rnd(-0.4,-0.1), alpha: rnd(0.05,0.25), flk: rnd(0,6.28), life: 1 }); break;
      }
      s.particles.push(p);
    }
    s.spawnFn = spawn;

    function loop() {
      s.frame++;
      const rates = [0.04, 0.14, 0.24, 0, 0.5, 0, 7, 0, 1.1, 2.2];
      const r = rates[s.level] || 0;
      for (let i = 0; i < Math.floor(r); i++) spawn();
      if (Math.random() < (r - Math.floor(r))) spawn();

      const maxP = [50, 90, 130, 0, 160, 0, 300, 200, 220, 380];
      s.particles = s.particles.filter(p => {
        if (p.lv !== s.level) return false;
        switch (p.lv) {
          case 0: p.x += p.vx + Math.sin(s.frame*0.007+p.ph)*0.5; p.y += p.vy; if (p.y < -p.r*2) { p.y = H()+p.r; p.x = Math.random()*W(); } return true;
          case 1: p.ph += p.phv; p.x += Math.sin(p.ph)*0.9; p.y += p.vy; p.life -= 0.003; p.alpha = p.life*0.09; return p.life > 0 && p.y > -30;
          case 2: p.x += p.vx; p.y += p.vy; p.rot += p.rotv; p.life -= 0.006; p.alpha = p.life*0.65; return p.life > 0;
          case 4: p.vy += p.grav; p.x += p.vx; p.y += p.vy; p.life -= 0.01; p.alpha = p.life*0.9; return p.life > 0 && p.y < H()+25;
          case 6: p.x += p.vx; p.y += p.vy; p.life -= 0.04; p.alpha = p.life*0.85; return p.life > 0;
          case 7: p.x += p.vx; p.y += p.vy; p.vx *= 0.93; p.vy *= 0.93; p.life -= 0.025; p.alpha = p.life*0.8; return p.life > 0;
          case 8: p.vy += p.grav; p.x += p.vx; p.y += p.vy; p.r *= 0.987; p.life -= 0.014; p.alpha = p.life*0.8; return p.life > 0 && p.y < H()+30;
          case 9: p.x += p.vx; p.y += p.vy; p.flk += 0.18; p.life -= 0.0028; p.alpha = Math.max(0, (0.4+Math.sin(p.flk)*0.3)*p.life*0.35); if (p.y < 0) { p.y = H(); p.x = Math.random()*W(); p.life = 0.8+Math.random()*0.2; } return p.life > 0;
        }
        return true;
      });
      if (s.particles.length > (maxP[s.level] || 0)) s.particles.splice(0, s.particles.length - (maxP[s.level] || 0));

      s.pulseRings = s.pulseRings.filter(r => { r.r += r.spd; r.alpha -= 0.009; return r.alpha > 0; });
      s.bolts = s.bolts.filter(b => { b.life--; b.alpha = b.life/7; return b.life > 0; });

      if (s.level === 7 && s.frame % 15 === 0) {
        const bx = rnd(W()*0.1, W()*0.9), by = rnd(H()*0.1, H()*0.9);
        for (let i = 0; i < 8+Math.floor(rnd(0,10)); i++) {
          const ang = (i/(8+Math.floor(rnd(0,10))))*Math.PI*2+rnd(-0.4,0.4), spd = 2+rnd(0,7);
          s.particles.push({ lv: 7, x: bx, y: by, r: 2+rnd(0,5), vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, alpha: 0.7+rnd(0,0.3), life: 1 });
        }
      }

      ctx.clearRect(0, 0, W(), H());
      draw();
      s.rafId = requestAnimationFrame(loop);
    }

    function draw() {
      switch (s.level) {
        case 0: drawSerene(); break;
        case 1: drawSteam(); break;
        case 2: drawSparkles(); break;
        case 3: drawPulse(); break;
        case 4: drawEmbers(); break;
        case 5: drawLightning(); break;
        case 6: drawWired(); break;
        case 7: drawToxic(); break;
        case 8: drawInferno(); break;
        case 9: drawGone(); break;
      }
    }

    function drawSerene() { s.particles.forEach(p => { const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r); g.addColorStop(0,`hsla(${p.hue},55%,65%,${p.alpha*3})`); g.addColorStop(0.5,`hsla(${p.hue},55%,65%,${p.alpha})`); g.addColorStop(1,`hsla(${p.hue},55%,65%,0)`); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fill(); }); }
    function drawSteam() { s.particles.forEach(p => { const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*5); g.addColorStop(0,`rgba(215,198,182,${p.alpha*1.6})`); g.addColorStop(0.4,`rgba(215,198,182,${p.alpha})`); g.addColorStop(1,'rgba(215,198,182,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*5,0,6.28); ctx.fill(); }); }
    function drawSparkles() { s.particles.forEach(p => { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.shadowColor=`rgba(255,190,0,${p.alpha*0.7})`; ctx.shadowBlur=8; ctx.fillStyle=`rgba(196,144,8,${p.alpha})`; const sz=p.r; ctx.beginPath(); for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2,r2=i%2===0?sz*2.2:sz*0.9; i===0?ctx.moveTo(Math.cos(a)*r2,Math.sin(a)*r2):ctx.lineTo(Math.cos(a)*r2,Math.sin(a)*r2);} ctx.closePath(); ctx.fill(); ctx.restore(); }); }
    function drawPulse() { const pulse=0.5+Math.sin(s.frame*0.07)*0.5; const bg=ctx.createRadialGradient(W()/2,H()/2,0,W()/2,H()/2,Math.max(W(),H())*0.55); bg.addColorStop(0,`rgba(192,57,43,${pulse*0.06})`); bg.addColorStop(1,'rgba(192,57,43,0)'); ctx.fillStyle=bg; ctx.fillRect(0,0,W(),H()); s.pulseRings.forEach(r => { ctx.save(); ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,6.28); ctx.strokeStyle=`rgba(192,57,43,${r.alpha})`; ctx.lineWidth=2; ctx.shadowColor=`rgba(255,60,60,${r.alpha*0.6})`; ctx.shadowBlur=12; ctx.stroke(); ctx.restore(); }); }
    function drawEmbers() { s.particles.forEach(p => { ctx.save(); ctx.shadowColor=`hsla(${p.hue},100%,60%,${p.alpha*0.5})`; ctx.shadowBlur=10; const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3); g.addColorStop(0,`hsla(${Math.min(60,p.hue+25)},100%,92%,${p.alpha})`); g.addColorStop(0.35,`hsla(${p.hue},100%,62%,${p.alpha*0.8})`); g.addColorStop(1,`hsla(${Math.max(0,p.hue-5)},100%,38%,0)`); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*3,0,6.28); ctx.fill(); ctx.restore(); }); }
    function drawLightning() { const mx=s.bolts.reduce((m,b)=>Math.max(m,b.life>4?b.alpha:0),0); if(mx>0){ctx.fillStyle=`rgba(170,90,255,${mx*0.05})`; ctx.fillRect(0,0,W(),H());} s.bolts.forEach(b=>{ctx.save(); ctx.strokeStyle=`rgba(200,120,255,${b.alpha*0.35})`; ctx.lineWidth=b.w*7; ctx.shadowColor=`rgba(180,80,255,${b.alpha})`; ctx.shadowBlur=22; b.segs.forEach(([x1,y1,x2,y2]:number[])=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}); ctx.strokeStyle=`rgba(228,190,255,${b.alpha*0.95})`; ctx.lineWidth=b.w; ctx.shadowBlur=5; b.segs.forEach(([x1,y1,x2,y2]:number[])=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}); ctx.restore();}); }
    function drawWired() { if(Math.random()<0.06){ctx.fillStyle=`rgba(0,240,255,${rnd(0.02,0.07)})`; ctx.fillRect(0,0,W(),H());} if(Math.random()<0.14){for(let i=0;i<1+Math.floor(Math.random()*2);i++){const iy=rnd(0,H()),iw=W()*rnd(0.2,1.0); ctx.fillStyle=`rgba(0,240,255,${rnd(0.05,0.14)})`; ctx.fillRect(0,iy,iw,1+Math.random()*2);}} s.particles.forEach(p=>{ctx.save(); ctx.shadowColor=`rgba(0,240,255,${p.alpha*0.9})`; ctx.shadowBlur=10; const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*4); g.addColorStop(0,`rgba(220,255,255,${p.alpha})`); g.addColorStop(0.35,`rgba(0,240,255,${p.alpha*0.8})`); g.addColorStop(1,'rgba(0,160,200,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*4,0,6.28); ctx.fill(); ctx.restore();}); }
    function drawToxic() { const pulse=0.5+Math.sin(s.frame*0.19)*0.5; ctx.fillStyle=`rgba(255,0,144,${0.02+pulse*0.04})`; ctx.fillRect(0,0,W(),H()); s.particles.forEach(p=>{ctx.save(); ctx.shadowColor=`rgba(255,0,144,${p.alpha})`; ctx.shadowBlur=18; const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3.5); g.addColorStop(0,`rgba(255,200,240,${p.alpha})`); g.addColorStop(0.25,`rgba(255,0,144,${p.alpha*0.85})`); g.addColorStop(1,'rgba(180,0,80,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*3.5,0,6.28); ctx.fill(); ctx.restore();}); }
    function drawInferno() { const bg=ctx.createLinearGradient(0,H()*0.55,0,H()); bg.addColorStop(0,'rgba(255,90,0,0)'); bg.addColorStop(0.65,'rgba(255,60,0,0.07)'); bg.addColorStop(1,'rgba(200,20,0,0.14)'); ctx.fillStyle=bg; ctx.fillRect(0,0,W(),H()); s.particles.forEach(p=>{ctx.save(); ctx.shadowColor=`hsla(${p.hue},100%,50%,${p.alpha*0.55})`; ctx.shadowBlur=18; const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*4); g.addColorStop(0,`hsla(60,100%,96%,${p.alpha})`); g.addColorStop(0.2,`hsla(45,100%,76%,${p.alpha*0.9})`); g.addColorStop(0.55,`hsla(${p.hue},100%,54%,${p.alpha*0.55})`); g.addColorStop(1,`hsla(${Math.max(0,p.hue-5)},100%,30%,0)`); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r*4,0,6.28); ctx.fill(); ctx.restore();}); }
    function drawGone() { for(let y=0;y<H();y+=4){ctx.fillStyle='rgba(0,0,0,0.03)'; ctx.fillRect(0,y,W(),1);} s.particles.forEach(p=>{ctx.fillStyle=`rgba(155,155,155,${p.alpha})`; ctx.fillRect(p.x,p.y,p.r,p.r*(0.4+Math.random()*0.6));}); if(Math.random()<0.045){const gy=Math.random()*H(),gh=2+Math.random()*7,gs=(Math.random()-0.5)*45; try{const img=ctx.getImageData(0,gy,W(),gh); ctx.putImageData(img,gs,gy);}catch(_){}} }

    s.rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(s.rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (level === s.level) return;
    s.particles = [];
    s.pulseRings = [];
    s.bolts = [];
    s.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    s.timers = [];
    s.level = level;

    const seeds = [12, 28, 45, 0, 55, 0, 80, 0, 80, 200];
    const canvas = canvasRef.current;
    const spawnFn = s.spawnFn;
    if (canvas && spawnFn) {
      // Seed fully-initialized particles via spawn() (it reads the updated
      // s.level). Pushing bare { lv } objects left x/y/r undefined, which
      // crashed createRadialGradient ("not a finite floating-point value").
      for (let i = 0; i < (seeds[level] || 0); i++) spawnFn(true);
    }

    // Heartbeat pulse rings for level 3
    if (level === 3) {
      const canvas2 = canvasRef.current;
      if (canvas2) {
        const beat = () => {
          if (s.level !== 3) return;
          s.pulseRings.push({ x: canvas2.width / 2, y: canvas2.height / 2, r: 10, alpha: 0.65, spd: 2.8 });
          const t = setTimeout(() => {
            if (s.level !== 3) return;
            s.pulseRings.push({ x: canvas2.width / 2, y: canvas2.height / 2, r: 10, alpha: 0.45, spd: 2.2 });
          }, 150);
          const t2 = setTimeout(beat, 950);
          s.timers.push(t, t2);
        };
        beat();
      }
    }
  }, [level]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
    />
  );
}
