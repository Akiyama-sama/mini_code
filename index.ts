import Agent from "./src/agents";
import { runRepl } from "./src/cli";

function main(){
    const agent = new Agent()
    runRepl(agent)
}

main()

