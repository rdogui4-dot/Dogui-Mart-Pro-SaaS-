# -*- coding: utf-8 -*-
import sys; sys.path.insert(0,'/tmp/lg')
from cdc import C
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
D='/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('F',D+'DejaVuSans.ttf')); pdfmetrics.registerFont(TTFont('FB',D+'DejaVuSans-Bold.ttf')); pdfmetrics.registerFont(TTFont('FI',D+'DejaVuSans.ttf'))
pdfmetrics.registerFontFamily('F',normal='F',bold='FB',italic='FI',boldItalic='FB')
NAVY=colors.HexColor('#0A1F6B'); GOLD=colors.HexColor('#E88409'); PALE=colors.HexColor('#FFF4DC')
LG='/home/user/dogui-mart-pro-saas-/docs/master-dogui/logo/png/'
st=lambda n,**k: ParagraphStyle(n,fontName=k.pop('fontName','F'),**k)
H1=st('h1',fontName='FB',fontSize=14,textColor=NAVY,spaceBefore=14,spaceAfter=6,leading=18)
H2=st('h2',fontName='FB',fontSize=10.5,textColor=GOLD,spaceBefore=8,spaceAfter=3,leading=14)
P=st('p',fontSize=9.2,leading=13.2,spaceAfter=5)
BL=st('b',fontSize=9.2,leading=13,leftIndent=12,bulletIndent=2,spaceAfter=2)
NT=st('n',fontName='FB',fontSize=9.4,leading=13.5,textColor=NAVY)
TD=st('td',fontSize=8.4,leading=11.2); TH=st('th',fontName='FB',fontSize=8.6,leading=11,textColor=colors.white)
def cover(c,d):
    c.saveState(); w,h=A4; c.setFillColor(colors.HexColor('#020A2C')); c.rect(0,0,w,h,fill=1,stroke=0)
    c.setFillColor(colors.HexColor('#0B2A8A')); c.circle(w/2,h*0.6,180*mm,fill=1,stroke=0); c.setFillColor(colors.HexColor('#020A2C')); c.rect(0,0,w,h*0.18,fill=1,stroke=0)
    c.drawImage(LG+'master-dogui-icone-disque-1024.png',w/2-45*mm,h-135*mm,90*mm,90*mm,mask='auto')
    c.setFillColor(colors.white); c.setFont('FB',30); c.drawCentredString(w/2,h-158*mm,'MASTER DOGUI')
    c.setFont('F',11.5); c.setFillColor(colors.HexColor('#FFD25A')); c.drawCentredString(w/2,h-170*mm,'CAHIER DES CHARGES FONCTIONNEL, TECHNIQUE ET COMMERCIAL')
    c.setFillColor(colors.white); c.setFont('F',10.5); c.drawCentredString(w/2,h-190*mm,'Le cerveau intelligent de DOGUI MART PRO')
    c.setFont('FI',10); c.drawCentredString(w/2,h-198*mm,'Une intelligence pour chaque boutique. Un directeur intelligent pour chaque commerçant.')
    c.setFont('F',9); c.setFillColor(colors.HexColor('#C9D3FF')); c.drawCentredString(w/2,34*mm,'Version 1.1 (révision de la v1.0 de novembre 2026)  ·  Constructeur : Claude  ·  Backend : Appwrite')
    c.drawCentredString(w/2,28*mm,'Document de cadrage : les points marqués « à confirmer » ou « à valider » ne sont pas décidés.')
    c.restoreState()
def pg(c,d):
    c.saveState(); w,h=A4; c.setFont('F',7.8); c.setFillColor(colors.grey); c.drawString(18*mm,10*mm,'MASTER DOGUI — Cahier des charges | Version 1.1'); c.drawRightString(w-18*mm,10*mm,f'Page {d.page}')
    c.setStrokeColor(GOLD); c.setLineWidth(1.2); c.line(18*mm,h-14*mm,w-18*mm,h-14*mm); c.restoreState()
doc=BaseDocTemplate('/home/user/dogui-mart-pro-saas-/docs/master-dogui/MASTER_DOGUI_Cahier_des_charges_v1.1.pdf',pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=20*mm,bottomMargin=17*mm,title='MASTER DOGUI — Cahier des charges v1.1',author='Claude')
fr=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='f')
doc.addPageTemplates([PageTemplate(id='c',frames=[Frame(0,0,1,1)],onPage=cover,autoNextPageTemplate='n'),PageTemplate(id='n',frames=[fr],onPage=pg)])
S=[PageBreak()]
for it in C:
    k=it[0]
    if k=='h1': S.append(Paragraph(it[1],H1))
    elif k=='h2': S.append(Paragraph(it[1],H2))
    elif k=='p': S.append(Paragraph(it[1],P))
    elif k=='b':
        for t in it[1]: S.append(Paragraph(t,BL,bulletText='•'))
        S.append(Spacer(1,3))
    elif k in('note','todo'):
        bg=PALE if k=='note' else colors.HexColor('#E8EEFF'); bd=GOLD if k=='note' else NAVY
        t=Table([[Paragraph(('À CONFIRMER — ' if k=='todo' else '')+it[1],NT if k=='note' else st('t',fontSize=9,leading=12.8,textColor=NAVY))]],colWidths=[doc.width]); t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),bg),('LINEBEFORE',(0,0),(0,-1),3,bd),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)])); S+= [t,Spacer(1,6)]
    elif k=='tbl':
        rows=it[1]; w=it[2]; sc=doc.width/sum(w) if w else 1; data=[[Paragraph(x,TH) for x in rows[0]]]+[[Paragraph(x,TD) for x in r] for r in rows[1:]]
        t=Table(data,colWidths=[x*sc for x in w],repeatRows=1); t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F3F5FB')]),('GRID',(0,0),(-1,-1),.4,colors.HexColor('#C5CBE0')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)])); S+=[t,Spacer(1,7)]
doc.build(S); print('pdf ok')
