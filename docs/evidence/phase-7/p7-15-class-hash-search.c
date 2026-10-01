/*
 * p7-15 (task 7.14, item 5): brute-force search for the class name behind a class hash.
 *
 * `hashs` is Imcodec.Cryptography.StringHash.Compute (C# int semantics); the name is `"class " +`
 * the concatenation of up to <depth> tokens from vocab.txt, and a name only counts when it contains
 * at least one seed token (Combat AI Data Brute Force Battle Fight). vocab.txt is every CamelCase token
 * that occurs >= 4 times in the two Imcodec class dumps, most frequent first (984 tokens):
 *
 *   for each class name in ClientDump.json + r806919_Wizard_1_610.json, take each identifier that is not
 *   class/struct/enum/std/allocator/list/vector/SharedPointer/pair/map/less/basic_string/char/char_traits,
 *   split it with /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/, count tokens, keep count >= 4.
 *
 * Build/run:  gcc -O2 -o bf p7-15-class-hash-search.c && ./bf <target hash> <depth> <vocab size>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
static int32_t hashs(const char*s){int32_t r=0;int sh1=0,sh2=32;for(;*s;s++){int cb=(unsigned char)*s;int v=cb-32;r^=(int32_t)((uint32_t)v<<(sh1&31));if(sh1>24){r^=(v>>(sh2&31));if(sh1>=27){sh1-=32;sh2+=32;}}sh1+=5;sh2-=5;}if(r<0)r=-r;return r;}
static char*V[20000];static int n,isseed[20000];static int32_t T;static int maxdepth;
static void rec(char*buf,int len,int depth,int hasseed){
  if(depth>0&&hasseed){buf[len]=0;if(hashs(buf)==T)printf("HIT %s\n",buf);}
  if(depth==maxdepth)return;
  for(int i=0;i<n;i++){int l=strlen(V[i]);memcpy(buf+len,V[i],l+1);rec(buf,len+l,depth+1,hasseed||isseed[i]);}
}
int main(int argc,char**argv){
  T=atoi(argv[1]);maxdepth=atoi(argv[2]);int minfreqcount=atoi(argv[3]);
  FILE*f=fopen("vocab.txt","r");char line[128];int k=0;
  while(fgets(line,128,f)){line[strcspn(line,"\n")]=0;if(!*line)continue;if(k++>=minfreqcount)break;V[n++]=strdup(line);}
  const char*seeds[]={"Combat","AI","Data","Brute","Force","Battle","Fight"};
  for(int i=0;i<n;i++){isseed[i]=0;for(int s=0;s<7;s++)if(!strcmp(V[i],seeds[s]))isseed[i]=1;}
  fprintf(stderr,"vocab %d depth %d\n",n,maxdepth);
  char buf[512];strcpy(buf,"class ");rec(buf,6,0,0);
  return 0;}
