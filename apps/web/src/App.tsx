import { Redirect, Route, Switch } from 'wouter';
import { CatalogPage } from './pages/CatalogPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { HomesPage } from './pages/HomesPage';
import { ListPage } from './pages/ListPage';
import { RatePage } from './pages/RatePage';
import { WelcomePage } from './pages/WelcomePage';
import { SignInDialog } from './ui/account/SignInDialog';

export function App() {
  return (
    <>
      <Switch>
        <Route path="/" component={WelcomePage} />
        <Route path="/homes" component={HomesPage} />
        <Route path="/catalog" component={CatalogPage} />
        <Route path="/admin/rate" component={RatePage} />
        <Route path="/plans/:id/check">{({ id }) => <EditorPage id={id} />}</Route>
        <Route path="/plans/:id/edit">{({ id }) => <EditorPage id={id} />}</Route>
        <Route path="/plans/:id/preferences">{({ id }) => <HomePage id={id} />}</Route>
        <Route path="/plans/:id/list">{({ id }) => <ListPage id={id} />}</Route>
        <Route path="/plans/:id/3d">
          {({ id }) => <Redirect to={`/plans/${id}${location.search}`} replace />}
        </Route>
        <Route path="/plans/:id">{({ id }) => <HomePage id={id} />}</Route>
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
      <SignInDialog />
    </>
  );
}
