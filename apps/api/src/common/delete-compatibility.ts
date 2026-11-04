import type {Request,Response,NextFunction} from 'express'

/** Translate the explicit POST envelope before Nest routes and guards run.
 * The original DELETE handler still checks permissions, ownership and audit.
 * Native DELETE remains supported; GET/query/body cannot override a method.
 */
export function deleteCompatibility(req:Request,_res:Response,next:NextFunction){
  if(req.method==='POST'&&req.get('X-CAgent-Method')==='DELETE'){
    req.method='DELETE'
    delete req.headers['x-cagent-method']
  }
  next()
}
