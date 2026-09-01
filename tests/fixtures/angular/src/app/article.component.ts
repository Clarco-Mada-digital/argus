import { Component } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-article',
  template: `<div [innerHTML]="contenuSecurise"></div>`,
})
export class ArticleComponent {
  contenuSecurise: any;

  constructor(private sanitizer: DomSanitizer) {}

  afficher(contenuDistant: string) {
    this.contenuSecurise = this.sanitizer.bypassSecurityTrustHtml(contenuDistant);
  }
}
