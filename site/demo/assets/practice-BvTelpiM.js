const r=["presentations","slides","bible","media","hymns","countdown","screen","calendar","editor","settings"],a={tr:{id:"practice-hymn-tr",title:"Alıştırma ilahisi",lyrics:`Sevginle yolumu aydınlat
Yüreğimde umut yeşersin

Birlikte sevgiyle yürüyelim
Her gün şükranla söyleyelim`},en:{id:"practice-hymn-en",title:"Practice hymn",lyrics:`Light my path with your love
Let hope grow in my heart

Together we walk in love
Each day we sing with thankful hearts`},de:{id:"practice-hymn-de",title:"Übungslied",lyrics:`Erhelle meinen Weg mit deiner Liebe
Lass Hoffnung in meinem Herzen wachsen

Gemeinsam gehen wir in Liebe
Jeden Tag singen wir voller Dank`},es:{id:"practice-hymn-es",title:"Himno de práctica",lyrics:`Ilumina mi camino con tu amor
Que crezca la esperanza en mi corazón

Caminemos juntos con amor
Cantemos cada día con gratitud`},ko:{id:"practice-hymn-ko",title:"연습 찬송",lyrics:`당신의 사랑으로 내 길을 밝혀 주세요
내 마음에 희망이 자라게 해 주세요

함께 사랑으로 걸어가요
날마다 감사하며 노래해요`}},t=["welcome","presentations","sidebar","nav-slides","add","add-result","reorder","select","delete","delete-result","nav-bible","bible-intro","bible-source","bible-import","bible-book","bible-chapter","bible-verse","bible-add","bible-result","nav-media","media-intro","media-menu","media-import","media-add","media-result","image-select","image-tools","image-fit","image-grayscale","image-edit-result","nav-hymns","hymns-intro","hymns-online","hymns-author","hymns-mode","hymns-add","hymns-result","hymns-parts","hymns-font","nav-countdown","countdown-intro","countdown-duration","countdown-add","countdown-result","nav-screen","screen-intro","nav-calendar","calendar-intro","nav-editor","editor-intro","editor-select","editor-rotate","editor-save","editor-result","nav-settings","settings-intro","phone-controls","nav-save","save","save-result","done"],o=t.filter(e=>e!=="delete-result"),d={presentations:"presentations",slides:"add",bible:"bible-intro",media:"media-intro",hymns:"hymns-intro",countdown:"countdown-intro",screen:"screen-intro",calendar:"calendar-intro",editor:"editor-intro",settings:"settings-intro"},i={"add-result":"slide-add","delete-result":"slide-delete","bible-result":"bible","media-result":"media","image-edit-result":"image-edit","editor-result":"canvas-edit","hymns-result":"hymns","countdown-result":"countdown","save-result":"presentations"};function l(e){return Object.hasOwn(i,e)}function s(e){if(["welcome","presentations","sidebar","nav-slides","save","save-result","done"].includes(e))return"presentations";if(["hymns-parts","hymns-font"].includes(e)||e.startsWith("image-"))return"slides";if(e==="phone-controls"||e==="nav-save")return"settings";if(e.startsWith("nav-")){const n=t.indexOf(e);return s(t[n-1])}for(const n of["bible","media","hymns","countdown","screen","calendar","editor","settings"])if(e.startsWith(n+"-"))return n;return"slides"}function c(e){return["welcome","presentations","sidebar","hymns-parts","hymns-font","image-tools","hymns-online","hymns-author","hymns-mode","phone-controls"].includes(e)||e.endsWith("-intro")}export{c as a,r as b,d as c,t as d,s as g,l as i,a as p,o as v};
