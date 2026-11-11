import os, glob
from PIL import Image
import numpy as np, potrace
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
SRC='/tmp/claude-0/-home-user/66afdd1b-6e9c-5a1a-b8ea-b7cd3b7f0355/images/4.webp'
a=np.array(Image.open(SRC).convert('L'))<128
pl=potrace.Bitmap(~a).trace(turdsize=20,alphamax=1.0,opttolerance=0.4)
def pd(c):
    sp=c.start_point; d=f"M{sp.x:.1f},{sp.y:.1f}"
    for s in c.segments:
        d+= f"L{s.c.x:.1f},{s.c.y:.1f}L{s.end_point.x:.1f},{s.end_point.y:.1f}" if s.is_corner else f"C{s.c1.x:.1f},{s.c1.y:.1f} {s.c2.x:.1f},{s.c2.y:.1f} {s.end_point.x:.1f},{s.end_point.y:.1f}"
    return d+"Z"
paths=[pd(c) for c in pl]; d="".join(paths)
def area(c):
    pts=[(c.start_point.x,c.start_point.y)]+[(s.end_point.x,s.end_point.y) for s in c.segments]
    return abs(sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts))))/2
big=max(pl,key=area); sil=pd(big)
OUT='/home/user/dogui-mart-pro-saas-/docs/master-dogui/logo/'
for f in glob.glob(OUT+'*.svg')+glob.glob(OUT+'png/*'): os.remove(f)
os.makedirs(OUT+'png',exist_ok=True)
VB="66 64 1130 1130"; NAVY1,NAVY2="#0B2A8A","#020A2C"; G1,G2,G3="#FFE07A","#F6B92B","#E88409"
def svg(body,vb=VB,w=None,extra=""):
    x,y,W,H=[float(t) for t in vb.split()]; ww=w or int(W)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{ww}" height="{int(H*ww/W)}" role="img" aria-label="MASTER DOGUI">{extra}{body}</svg>\n'
mark=lambda fill,dd=d: f'<path fill-rule="evenodd" fill="{fill}" d="{dd}"/>'
w=lambda n,s: open(OUT+n,'w').write(s)
gdef=f'<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2="1150"><stop offset="0" stop-color="{G1}"/><stop offset=".45" stop-color="{G2}"/><stop offset="1" stop-color="{G3}"/></linearGradient>'
w('master-dogui-symbole-noir.svg',svg('<title>MASTER DOGUI — symbole noir</title>'+mark('#000000')))
w('master-dogui-symbole-blanc.svg',svg('<title>MASTER DOGUI — symbole blanc (sur fond sombre)</title>'+mark('#FFFFFF')))
w('master-dogui-symbole-or.svg',svg('<title>MASTER DOGUI — symbole or</title>'+mark('url(#g)'),extra='<defs>'+gdef+'</defs>'))
defs=f'<defs>{gdef}<radialGradient id="bg" cx=".5" cy=".42" r=".65"><stop offset="0" stop-color="{NAVY1}"/><stop offset="1" stop-color="{NAVY2}"/></radialGradient><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
def icon(shape,scale):
    cx,cy=631.5,628.5; t=f'translate({627-cx*scale:.1f} {627-cy*scale:.1f}) scale({scale})'
    bg={'disc':'<circle cx="627" cy="627" r="610" fill="url(#bg)"/><circle cx="627" cy="627" r="610" fill="none" stroke="#2F6BFF" stroke-opacity=".5" stroke-width="6"/>','rounded':'<rect width="1254" height="1254" rx="280" fill="url(#bg)"/>','full':'<rect width="1254" height="1254" fill="url(#bg)"/>'}[shape]
    return svg(f'<title>MASTER DOGUI</title>{bg}<g transform="{t}" filter="url(#glow)">{mark("url(#g)")}</g>',vb="0 0 1254 1254",w=1254,extra=defs)
w('master-dogui-icone-disque.svg',icon('disc',0.72)); w('master-dogui-icone-app-arrondie.svg',icon('rounded',0.74)); w('master-dogui-icone-maskable.svg',icon('full',0.56))
# petite taille : silhouette or + stèle et 6 noeuds bleu nuit
nodes=[(743,247),(917,413),(1012,517),(507,245),(330,470),(215,536)]
lines=''.join(f'<path d="M{x} {y}L{627} {627+ (y-300)*0.0 + 0}" />' for x,y in [])  # placeholder
sm=f'<g fill="url(#g)"><path fill-rule="evenodd" d="{sil}"/></g><g stroke="{NAVY2}" stroke-width="30" stroke-linecap="round" fill="none"><path d="M627 200V820"/><path d="M743 247V330L627 440"/><path d="M917 413L760 560"/><path d="M507 245L627 360"/><path d="M330 470L480 600"/></g><g fill="{NAVY2}">'+''.join(f'<circle cx="{x}" cy="{y}" r="46"/>' for x,y in nodes)+'</g>'
cx,cy=631.5,628.5; s=0.66; t=f'translate({627-cx*s:.1f} {627-cy*s:.1f}) scale({s})'
w('master-dogui-icone-petite-taille.svg',svg(f'<title>MASTER DOGUI — icône simplifiée (16 à 64 px)</title><rect width="1254" height="1254" rx="280" fill="url(#bg)"/><g transform="{t}">{sm}</g>',vb="0 0 1254 1254",w=256,extra=defs))
FONT='/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
def tp(txt,ff,size,sp=0):
    f=TTFont(ff); gs=f.getGlyphSet(); cm=f.getBestCmap(); sc=size/f['head'].unitsPerEm; out=[]; x=0
    for ch in txt:
        gn=cm[ord(ch)]; pen=SVGPathPen(gs); gs[gn].draw(TransformPen(pen,(sc,0,0,-sc,x,0))); out.append(pen.getCommands()); x+=gs[gn].width*sc+sp
    return ''.join(out),x
t1,w1=tp('MASTER',FONT,128,10); t2,w2=tp('DOGUI',FONT,128,10); tg,wt=tp('UNE INTELLIGENCE POUR CHAQUE BOUTIQUE',FONT.replace('Bold','Regular'),30,3)
W=1230+w1+36+w2+140
def lock(dark):
    tf='#FFFFFF' if dark else '#0A1F6B'; bgr=f'<rect x="-60" y="-40" width="{W}" height="1210" rx="70" fill="url(#bg)"/>' if dark else ''
    body=f'{bgr}<g transform="translate(0 0)"><g transform="translate(0 0)">{mark("url(#g)")}</g></g><g transform="translate(1230 640)"><path fill="{tf}" d="{t1}"/><g transform="translate({w1+36} 0)"><path fill="{"#FFD25A" if dark else "#D97A06"}" d="{t2}"/></g></g><g transform="translate(1234 740)"><path fill="{tf}" fill-opacity=".8" d="{tg}"/></g>'
    return svg('<title>MASTER DOGUI — logo horizontal</title>'+body,vb=f"-60 -40 {W:.0f} 1210",w=1400,extra=defs)
w('master-dogui-horizontal-fond-clair.svg',lock(False)); w('master-dogui-horizontal-fond-sombre.svg',lock(True))
import cairosvg
for f in sorted(glob.glob(OUT+'*.svg')):
    n=os.path.basename(f)[:-4]
    if 'horizontal' in n: cairosvg.svg2png(url=f,write_to=OUT+f'png/{n}-1400.png',output_width=1400)
    elif 'petite' in n:
        for sz in (32,48,64,180,192,512): cairosvg.svg2png(url=f,write_to=OUT+f'png/{n}-{sz}.png',output_width=sz)
    else:
        for sz in (512,1024): cairosvg.svg2png(url=f,write_to=OUT+f'png/{n}-{sz}.png',output_width=sz)
print(sorted(os.listdir(OUT)))
