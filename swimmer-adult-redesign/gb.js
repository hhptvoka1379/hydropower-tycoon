class GB{constructor(){this.p=[];this.n=[];this.c=[];this.s=null;}
  v(x,y,z,nx,ny,nz,c,a){this.p.push(x,y,z);this.n.push(nx,ny,nz);this.c.push(c[0],c[1],c[2],a||0);}
  tri(a,b,c,col,wa,wb,wc){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
    this.v(a[0],a[1],a[2],nx,ny,nz,col,wa);this.v(b[0],b[1],b[2],nx,ny,nz,col,wb);this.v(c[0],c[1],c[2],nx,ny,nz,col,wc);}
  quad(a,b,c,d,col){this.tri(a,b,c,col);this.tri(a,c,d,col);}
  box(T,lx,ly,lz,sx,sy,sz,col){const hx=sx/2,hz=sz/2;const P=[];for(let i=0;i<8;i++){P.push(T(lx+((i&1)?hx:-hx),ly+((i&2)?sy:0),lz+((i&4)?hz:-hz)));}
    this.quad(P[0],P[1],P[3],P[2],col);this.quad(P[4],P[6],P[7],P[5],col);this.quad(P[0],P[4],P[5],P[1],col);this.quad(P[2],P[3],P[7],P[6],col);this.quad(P[0],P[2],P[6],P[4],col);this.quad(P[1],P[5],P[7],P[3],col);}
  cyl(a,b,r,seg,col,caps,gap,r2){r2=r2===undefined?r:r2;const ax=b[0]-a[0],ay=b[1]-a[1],az=b[2]-a[2];const l=Math.hypot(ax,ay,az)||1;const dx=ax/l,dy=ay/l,dz=az/l;
    let ux=0,uy=1,uz=0;if(Math.abs(dy)>0.9){ux=1;uy=0;}let px=uy*dz-uz*dy,py=uz*dx-ux*dz,pz=ux*dy-uy*dx;let pl=Math.hypot(px,py,pz);px/=pl;py/=pl;pz/=pl;const qx=dy*pz-dz*py,qy=dz*px-dx*pz,qz=dx*py-dy*px;
    const g=gap||0;const a0=g/2,a1=Math.PI*2-g/2;const pt=(c,ang,rr)=>{const cs=Math.cos(ang+Math.PI/2),sn=Math.sin(ang+Math.PI/2);return [c[0]+(px*cs+qx*sn)*rr,c[1]+(py*cs+qy*sn)*rr,c[2]+(pz*cs+qz*sn)*rr];};
    for(let i=0;i<seg;i++){const t0=a0+(a1-a0)*i/seg,t1=a0+(a1-a0)*(i+1)/seg;const A=pt(a,t0,r),B=pt(a,t1,r),C=pt(b,t1,r2),D=pt(b,t0,r2);this.quad(A,B,C,D,col);if(caps&&!g){this.tri(a,B,A,col);this.tri(b,D,C,col);}}}
  cone(base,h,r,seg,col,wTop){for(let i=0;i<seg;i++){const t0=i/seg*Math.PI*2,t1=(i+1)/seg*Math.PI*2;const A=[base[0]+Math.cos(t0)*r,base[1],base[2]+Math.sin(t0)*r],B=[base[0]+Math.cos(t1)*r,base[1],base[2]+Math.sin(t1)*r],C=[base[0],base[1]+h,base[2]];
    this.tri(A,B,C,col,0,0,wTop||0);this.tri(A,[base[0],base[1],base[2]],B,col);}}
}
