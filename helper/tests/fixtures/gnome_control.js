// Loaded only by the private native test runner, never shipped as a companion.
import DesktopAccess from './production.js';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
export default class NativeFixtureAccess extends DesktopAccess {
    // Private fixture binaries have Rust test-runner names. Production still
    // requires the human-approved helper executable path and exact peer UID.
    isCallerAllowed(_owner) {return this.access.enabled;}
    input(owner,args) {this.latest=args;return super.input(owner,args);}
    CallAsync([method,json],invocation) {
        if(method!=='Fixture')return super.CallAsync([method,json],invocation);
        const args=JSON.parse(json);
        if(args.op==='debug') {
            let actor=global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,args.x,args.y);const chain=[];
            while(actor) {chain.push({type:actor.constructor.name,meta:actor.meta_window?.get_stable_sequence(),meta2:actor.metaWindow?.get_stable_sequence()});actor=actor.get_parent();}
            invocation.return_value(new GLib.Variant('(s)',[JSON.stringify({chain,latest:this.latest,size:[global.stage.width,global.stage.height]})]));return;
        }
        if(args.op==='run')Main.openRunDialog();
        if(args.op==='dismiss')Main.runDialog?.close();
        if(args.op==='shell-state'){invocation.return_value(new GLib.Variant('(s)',[JSON.stringify({modal:Main.modalCount,text:Main.runDialog?._entryText?.text??''})]));return;}
        if(args.op==='allow')this.setAccess(true);
        if(args.op==='pause')this.setAccess(false);
        if(args.op==='focus') {
            Main.overview.hide();
            const actor=this.actors().find(a=>a.meta_window.get_pid()===args.pid);
            if(actor)Main.activateWindow(actor.meta_window);
        }
        if(args.op==='move') {
            const actor=this.actors().find(a=>a.meta_window.get_pid()===args.pid);
            if(actor)actor.meta_window.move_resize_frame(true,args.x,args.y,args.width,args.height);
        }
        if(args.op==='above') {
            const actor=this.actors().find(a=>a.meta_window.get_pid()===args.pid);
            if(actor)actor.meta_window.make_above();
        }
        invocation.return_value(new GLib.Variant('(s)',[JSON.stringify({ok:true,windows:this.actors().map(a=>this.windowInfo(a.meta_window))})]));
    }
}
